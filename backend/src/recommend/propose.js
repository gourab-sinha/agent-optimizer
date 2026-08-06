/**
 * Propose - Two-phase LLM recommendation generation
 *
 * Phase 1 (diagnose): Choose lever/recType per top pattern (strategy only)
 * Phase 2 (expand):   Produce full payloads for chosen strategies
 *
 * Falls back to a single combined call if phase 1 yields nothing usable.
 */

import { callLLM } from '../services/llmService.js';
import { buildRecTypeCatalog, isValidRecType, REC_TYPE_PREFERENCE } from './recTypes.js';
import { normalizeProposals } from './normalize.js';

function parseJsonContent(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/```json?\n?/g, '')
      .replace(/```\n?$/g, '')
      .trim();
  }
  return JSON.parse(cleaned);
}

function extractArray(parsed, keys = ['strategies', 'recommendations', 'proposals']) {
  if (Array.isArray(parsed)) return parsed;
  for (const k of keys) {
    if (parsed && Array.isArray(parsed[k])) return parsed[k];
  }
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
}

async function callJsonLLM({ prompt, systemPrompt, stage, temperature = 0.25, maxTokens = 8000 }) {
  const result = await callLLM({
    prompt,
    systemPrompt,
    stage,
    temperature,
    maxTokens,
  });

  try {
    return { parsed: parseJsonContent(result.content), raw: result };
  } catch (err) {
    // One repair attempt
    console.warn(`   ⚠️  JSON parse failed (${stage}), retrying...`);
    const retry = await callLLM({
      prompt: `Your previous response was not valid JSON.\nError: ${err.message}\n\nReturn ONLY valid JSON for the original task. No markdown.\n\nOriginal task prompt:\n${prompt.slice(0, 6000)}`,
      systemPrompt: systemPrompt + '\n\nCRITICAL: Output valid JSON only.',
      stage: `${stage}_retry`,
      temperature: 0.1,
      maxTokens,
    });
    return { parsed: parseJsonContent(retry.content), raw: retry };
  }
}

function formatPatterns(patterns) {
  return patterns
    .map((p) => {
      const rationaleText =
        p.rationales?.length > 0
          ? `\n  Finding rationales:\n${p.rationales.map((r, i) => `    ${i + 1}. "${r}"`).join('\n')}`
          : '';
      const evidenceText =
        p.evidence?.length > 0
          ? `\n  Evidence turns:\n${p.evidence.map((e, i) => `    ${i + 1}. "${e}"`).join('\n')}`
          : '';

      return `Pattern id="${p.id}":
  Title: ${p.title}
  Description: ${p.description}
  Criterion: ${p.criterionKey} (id=${p.criterionId}, severity=${p.criterionSeverity}, category=${p.criterionCategory})
  Impact: ${p.failCount}/${p.callCount} fails (score=${Number(p.impactScore).toFixed(2)})${rationaleText}${evidenceText}`;
    })
    .join('\n\n');
}

function formatActions(actions) {
  if (!actions?.length) return '  (no actions configured)';
  return actions
    .map((a) => {
      const params = truncateJson(a.actionParameters, 200);
      return `  - id=${a.actionId}
    type=${a.actionType}
    name=${a.actionName}
    instructions=${a.instructions ? JSON.stringify(a.instructions) : '""'}
    parameters=${params}`;
    })
    .join('\n');
}

function truncateJson(obj, max = 200) {
  try {
    const s = JSON.stringify(obj ?? {});
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return '{}';
  }
}

function formatTestResults(testResults) {
  if (!testResults) return 'No completed test runs yet (pattern-only mode).';

  const failing = testResults.cases.filter((c) => c.passRate < 1);
  if (failing.length === 0) {
    return `Test run ${testResults.runId}: all ${testResults.cases.length} cases passing (overall ${(
      (testResults.summary?.overallPassRate || 1) * 100
    ).toFixed(0)}%).`;
  }

  return `Test run ${testResults.runId} (${testResults.runsPerCase} runs/case), failing ${failing.length}/${testResults.cases.length}:

${failing
  .map((c) => {
    const fc =
      c.failedCriteria?.length > 0
        ? `\n  Failed criteria:\n${c.failedCriteria
            .map(
              (f) =>
                `    - ${f.key} (${f.criterionId}): ${f.exampleRationale || ''}`
            )
            .join('\n')}`
        : '';
    return `Case id="${c.id}":
  Title: ${c.title}
  Pass rate: ${(c.passRate * 100).toFixed(0)}%${c.flaky ? ' (FLAKY)' : ''}${
      c.seededByPatternId ? `\n  Seeded by pattern: ${c.seededByPatternId}` : ''
    }${fc}`;
  })
  .join('\n\n')}`;
}

function formatPriors(priors) {
  if (!priors?.length) return 'None.';
  return priors
    .map(
      (p) =>
        `- [${p.status}] ${p.recType}: ${p.rationale} (patterns: ${(p.linkedPatternIds || []).join(', ') || 'n/a'})`
    )
    .join('\n');
}

function buildAgentSection(agent) {
  return `AGENT CONFIGURATION:
Prompt:
"""
${agent.prompt}
"""

Welcome Message: "${agent.welcomeMessage}"

Model Settings:
  Model: ${agent.model || 'default'}
  Temperature: ${agent.temperature !== null && agent.temperature !== undefined ? agent.temperature : 'default'}
  Voice ID: ${agent.voiceId || 'default'}
  Language: ${agent.language || 'default'}

Call Behavior:
  Patience Level: ${agent.patienceLevel}
  Max Call Duration: ${agent.maxCallDuration}s
  End Call Function: ${agent.endCallFunctionEnabled ? 'enabled' : 'disabled'}
  Voicemail Detection: ${agent.enableVoicemailDetection ? 'enabled' : 'disabled'}
  Wait For Greeting: ${agent.waitForGreeting ? 'yes' : 'no'}

Knowledge Base: ${agent.knowledgeBase ? 'configured' : 'none'}
Transfer Numbers: ${
    agent.transferNumbers?.length ? agent.transferNumbers.join(', ') : 'none'
  }

Actions:
${formatActions(agent.actions)}`;
}

function buildDiagnoseSystemPrompt() {
  return `You are an expert Voice AI agent optimizer (phase 1: diagnosis).

For each recurring issue pattern, choose EXACTLY ONE recommendation type that best addresses the root cause.

Prefer surgical levers in this order when applicable:
${REC_TYPE_PREFERENCE.join(' > ')}

Rules:
- Fix tool/action failures with action_update or action_add, NOT full prompt rewrites.
- Prefer prompt_edit (exact substring replace) or guardrail (append rule) over prompt_patch.
- Use only pattern ids and criterion ids from the input.
- Do NOT invent new pattern or criterion ids.
- Skip patterns that already have a good open recommendation covering the same fix (see prior list).
- Return 1 strategy per pattern you choose to address (2-6 total). You may skip low-impact patterns.

Return JSON:
{
  "strategies": [
    {
      "patternId": "uuid",
      "recType": "one of valid types",
      "rootCause": "1-2 sentences",
      "confidence": 0.0-1.0,
      "risk": "low|medium|high",
      "primaryCriterionId": "uuid from the pattern's criterion"
    }
  ]
}`;
}

function buildDiagnoseUserPrompt(input) {
  return `${buildAgentSection(input.agent)}

================================================================================
RECURRING ISSUES (Top by Impact):
${formatPatterns(input.patterns)}

================================================================================
TEST RESULTS:
${formatTestResults(input.testResults)}

================================================================================
PRIOR RECOMMENDATIONS (do not repeat):
${formatPriors(input.priorRecommendations)}

================================================================================
VALID recTypes:
${input.constraints.recTypes.join(', ')}

Criterion map (key → id):
${Object.entries(input.constraints.criterionIds)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n')}

Return diagnosis strategies as JSON only.`;
}

function buildExpandSystemPrompt() {
  const catalog = buildRecTypeCatalog();
  return `You are an expert Voice AI agent optimizer (phase 2: payload expansion).

Given diagnosed strategies, produce FULL recommendation objects with valid payloads.

REC TYPE CATALOG:
${catalog}

PAYLOAD RULES:
- action_update: { "actionId": "<existing id>", "changes": { "instructions"?: string, "name"?: string, "actionParameters"?: object } }
  changes MUST be non-empty and actually improve the action.
- action_add: { "actionType": "<from list>", "name": "string", "actionParameters": {}, "instructions"?: "string" }
- prompt_edit: { "find": "exact substring from current prompt", "replace": "replacement text" }
  find MUST appear verbatim in the current prompt.
- prompt_patch: { "newPrompt": "COMPLETE prompt" } — last resort only; preserve all compliance/opt-out language.
- welcome_message: { "newMessage": "string" }
- patience_level: { "value": "low"|"medium"|"high" }
- max_call_duration: { "seconds": 180-900 integer }
- idle_reminder: { "enabled": bool, "afterSeconds": 1-20 }
- kb_attach: { "faqEntries": [ ... ] }
- guardrail: { "promptAddition": "string" }
- escalation_rule: { "trigger": "string", "promptAddition": "string", "transferAction"?: object }
- advisory_temperature: { "value": 0-1 float }
- advisory_model: { "suggestion": "string" }

GLOBAL RULES:
- Maximum ONE prompt_patch in the whole array.
- linkedPatternIds and expectedCriterionIds must use provided UUIDs only.
- supportingTestCaseIds may be empty or ids of failing cases that support the fix.
- confidence 0-1, risk low|medium|high.
- rationale must cite evidence (impact counts / rationales).

Return JSON:
{
  "recommendations": [
    {
      "recType": "...",
      "payload": {},
      "rationale": "...",
      "linkedPatternIds": ["..."],
      "expectedCriterionIds": ["..."],
      "supportingTestCaseIds": [],
      "confidence": 0.8,
      "risk": "low",
      "rootCause": "..."
    }
  ]
}`;
}

function buildExpandUserPrompt(input, strategies) {
  return `${buildAgentSection(input.agent)}

================================================================================
STRATEGIES TO EXPAND (follow these recTypes — do not invent different types unless payload impossible):
${JSON.stringify(strategies, null, 2)}

================================================================================
PATTERN DETAIL:
${formatPatterns(input.patterns)}

================================================================================
TEST RESULTS:
${formatTestResults(input.testResults)}

================================================================================
Failing test case ids (optional supportingTestCaseIds):
${
  input.testResults?.cases
    ?.filter((c) => c.passRate < 1)
    .map((c) => `  ${c.id} — ${c.title}`)
    .join('\n') || '  (none)'
}

Expand into full recommendations JSON only.`;
}

/**
 * Phase 1: diagnose strategies
 */
export async function diagnoseStrategies(input) {
  console.log('\n🔍 Phase 1: Diagnosing strategies...');
  const { parsed } = await callJsonLLM({
    prompt: buildDiagnoseUserPrompt(input),
    systemPrompt: buildDiagnoseSystemPrompt(),
    stage: 'recommend_diagnose',
    temperature: 0.2,
    maxTokens: 4000,
  });

  let strategies = extractArray(parsed, ['strategies']);
  strategies = strategies
    .filter((s) => s && s.patternId && s.recType)
    .map((s) => ({
      patternId: s.patternId,
      recType: s.recType,
      rootCause: s.rootCause || '',
      confidence:
        typeof s.confidence === 'number' ? s.confidence : 0.6,
      risk: ['low', 'medium', 'high'].includes(s.risk) ? s.risk : 'medium',
      primaryCriterionId: s.primaryCriterionId || null,
    }))
    .filter((s) => isValidRecType(s.recType))
    .filter((s) => input.patterns.some((p) => p.id === s.patternId))
    .slice(0, 6);

  // Fill primaryCriterionId from pattern if missing
  strategies = strategies.map((s) => {
    const pat = input.patterns.find((p) => p.id === s.patternId);
    return {
      ...s,
      primaryCriterionId: s.primaryCriterionId || pat?.criterionId || null,
    };
  });

  console.log(`   ✓ ${strategies.length} strateg(ies)`);
  return strategies;
}

/**
 * Phase 2: expand strategies into full proposals
 */
export async function expandProposals(input, strategies) {
  console.log('\n🛠️  Phase 2: Expanding payloads...');
  if (!strategies.length) return [];

  const { parsed } = await callJsonLLM({
    prompt: buildExpandUserPrompt(input, strategies),
    systemPrompt: buildExpandSystemPrompt(),
    stage: 'recommend_expand',
    temperature: 0.25,
    maxTokens: 16000,
  });

  let proposals = extractArray(parsed, [
    'recommendations',
    'proposals',
    'strategies',
  ]);
  proposals = normalizeProposals(proposals);

  // Ensure linkage from strategies when model omits ids
  proposals = proposals.map((p, i) => {
    const strat = strategies[i] || strategies.find((s) => s.recType === p.recType);
    if (strat) {
      if (!p.linkedPatternIds?.length) {
        p.linkedPatternIds = [strat.patternId];
      }
      if (!p.expectedCriterionIds?.length && strat.primaryCriterionId) {
        p.expectedCriterionIds = [strat.primaryCriterionId];
      }
      if (p.confidence === 0.5 && strat.confidence) {
        p.confidence = strat.confidence;
      }
      if (!p.risk) p.risk = strat.risk;
      if (!p.rootCause) p.rootCause = strat.rootCause;
    }
    return p;
  });

  console.log(`   ✓ ${proposals.length} proposal(s)`);
  return proposals;
}

/**
 * Single-shot fallback if two-phase fails
 */
async function proposeSingleShot(input) {
  console.log('\n🤖 Fallback: single-shot proposal...');
  const systemPrompt = `You are an AI agent optimizer. Generate 2-6 recommendations.
Prefer surgical types (${REC_TYPE_PREFERENCE.slice(0, 6).join(', ')}) over prompt_patch.
${buildExpandSystemPrompt()}`;

  const userPrompt = `${buildAgentSection(input.agent)}

PATTERNS:
${formatPatterns(input.patterns)}

TESTS:
${formatTestResults(input.testResults)}

PRIORS:
${formatPriors(input.priorRecommendations)}

CONSTRAINTS recTypes: ${input.constraints.recTypes.join(', ')}
actionTypes: ${input.constraints.actionTypes.join(', ')}
criteria: ${JSON.stringify(input.constraints.criterionIds)}

Return {"recommendations":[...]} JSON only.`;

  const { parsed } = await callJsonLLM({
    prompt: userPrompt,
    systemPrompt,
    stage: 'recommend',
    temperature: 0.3,
    maxTokens: 16000,
  });

  return normalizeProposals(
    extractArray(parsed, ['recommendations', 'proposals'])
  );
}

/**
 * Full two-phase proposal pipeline
 *
 * @param {Object} input - assembled context
 * @param {Object} [options]
 * @param {boolean} [options.singleShot=false] - skip two-phase
 * @returns {Promise<Array>}
 */
export async function proposeRecommendations(input, options = {}) {
  if (options.singleShot) {
    return proposeSingleShot(input);
  }

  try {
    const strategies = await diagnoseStrategies(input);
    if (strategies.length === 0) {
      console.warn('   ⚠️  No strategies — falling back to single-shot');
      return proposeSingleShot(input);
    }
    const expanded = await expandProposals(input, strategies);
    if (expanded.length === 0) {
      console.warn('   ⚠️  Expand empty — falling back to single-shot');
      return proposeSingleShot(input);
    }
    return expanded;
  } catch (err) {
    console.error('   ✗ Two-phase failed:', err.message);
    console.warn('   → Falling back to single-shot');
    return proposeSingleShot(input);
  }
}
