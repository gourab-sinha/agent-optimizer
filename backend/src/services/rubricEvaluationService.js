/**
 * Rubric Evaluation Service
 * Generates rubrics from agent prompts and evaluates calls against criteria
 */

import crypto from 'crypto';
import db from '../db/connection.js';
import { callLLM } from './llmService.js';

/**
 * Generate rubric for an agent version
 * @param {UUID} agentVersionId - Agent version to generate rubric for
 * @returns {Promise<{rubricId: UUID, criteriaCount: number}>}
 */
export async function generateRubricForAgentVersion(agentVersionId) {
  // Fetch agent version config
  const versionResult = await db.query(
    `SELECT id, agent_id, config, actions FROM agent_versions WHERE id = $1 AND is_deleted = false`,
    [agentVersionId]
  );

  if (versionResult.rows.length === 0) {
    throw new Error(`Agent version ${agentVersionId} not found`);
  }

  const version = versionResult.rows[0];
  const config = version.config;
  const actions = version.actions;

  // Fetch sample calls to understand real agent behavior
  const sampleCalls = await fetchSampleCalls(version.agent_id, 3);

  // Build the prompt for rubric generation
  const prompt = buildRubricGenerationPrompt(config, actions, sampleCalls);

  // Call LLM to generate rubric
  const result = await callLLM({
    prompt,
    systemPrompt: 'You are an expert at analyzing voice AI agent configurations and generating evaluation rubrics.',
    stage: 'rubric',
    refId: agentVersionId,
    temperature: 0.2, // Low temperature for consistency
    maxTokens: 4096,
  });

  // Parse and validate the response
  let rubricData;
  try {
    rubricData = JSON.parse(result.content);
  } catch (error) {
    throw new Error(`Failed to parse LLM rubric response: ${error.message}\nResponse: ${result.content}`);
  }

  // Validate rubric structure
  validateRubricData(rubricData);

  // Calculate content hash
  const contentHash = generateContentHash(rubricData.criteria);

  // Check if identical rubric already exists
  const existingRubric = await db.query(
    `SELECT id FROM rubrics
     WHERE agent_version_id = $1 AND content_hash = $2 AND is_deleted = false
     ORDER BY version DESC LIMIT 1`,
    [agentVersionId, contentHash]
  );

  if (existingRubric.rows.length > 0) {
    console.log(`[Rubric] Identical rubric already exists for version ${agentVersionId}`);
    return {
      rubricId: existingRubric.rows[0].id,
      criteriaCount: rubricData.criteria.length,
      cached: true,
    };
  }

  // Get latest version number
  const versionResult2 = await db.query(
    `SELECT COALESCE(MAX(version), 0) as max_version
     FROM rubrics
     WHERE agent_version_id = $1`,
    [agentVersionId]
  );

  const newVersion = versionResult2.rows[0].max_version + 1;

  // Insert rubric
  const rubricResult = await db.query(
    `INSERT INTO rubrics (agent_version_id, version, content_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [agentVersionId, newVersion, contentHash]
  );

  const rubricId = rubricResult.rows[0].id;

  // Insert criteria using batch insert for better performance
  const criteriaRows = rubricData.criteria.map(criterion => [
    rubricId,
    criterion.key,
    criterion.category,
    criterion.description,
    criterion.checkType,
    JSON.stringify(criterion.checkSpec),
    criterion.severity,
    criterion.enabled !== false, // Default to true if not specified
  ]);

  await db.batchInsert(
    'rubric_criteria',
    ['rubric_id', 'key', 'category', 'description', 'check_type', 'check_spec', 'severity', 'enabled'],
    criteriaRows
  );

  console.log(`[Rubric] Generated rubric ${rubricId} (v${newVersion}) with ${rubricData.criteria.length} criteria`);

  return {
    rubricId,
    criteriaCount: rubricData.criteria.length,
    cached: false,
  };
}

/**
 * Fetch sample calls to understand real agent behavior
 */
async function fetchSampleCalls(agentId, limit = 3) {
  const result = await db.query(
    `SELECT c.id, c.summary, c.duration_s, c.executed_actions, c.extracted_data,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'idx', ct.idx,
                'speaker', ct.speaker,
                'text', ct.text
              ) ORDER BY ct.idx)
              FROM call_turns ct
              WHERE ct.call_id = c.id AND ct.is_deleted = false),
              '[]'::json
            ) as turns
     FROM calls c
     WHERE c.agent_id = $1 AND c.is_deleted = false
     ORDER BY c.created_at_ghl DESC
     LIMIT $2`,
    [agentId, limit]
  );

  return result.rows;
}

/**
 * Build the prompt for rubric generation
 */
function buildRubricGenerationPrompt(config, actions, sampleCalls = []) {
  const prompt = config.prompt || '';
  const model = config.model || 'Unknown';
  const temperature = config.temperature || 'Not specified';

  // Extract action names
  const actionNames = Array.isArray(actions)
    ? actions.map(a => a.name || a.title || 'unnamed').join(', ')
    : 'None';

  // Build sample calls context
  let sampleCallsContext = '';
  if (sampleCalls.length > 0) {
    sampleCallsContext = '\n\nSAMPLE CALLS (real agent behavior):\n';
    sampleCalls.forEach((call, idx) => {
      const turns = Array.isArray(call.turns) ? call.turns : [];
      const transcript = turns.map(t => `${t.speaker.toUpperCase()}: ${t.text}`).join('\n');
      const executedActions = Array.isArray(call.executed_actions) ? call.executed_actions : [];
      const extractedData = call.extracted_data || {};

      sampleCallsContext += `\nCall ${idx + 1}:\n`;
      sampleCallsContext += `Summary: ${call.summary || 'N/A'}\n`;
      sampleCallsContext += `Duration: ${call.duration_s || 0}s\n`;

      if (executedActions.length > 0) {
        sampleCallsContext += `Actions Executed: ${executedActions.map(a => a.name || a.action || 'unknown').join(', ')}\n`;
      }

      if (Object.keys(extractedData).length > 0) {
        sampleCallsContext += `Data Extracted: ${JSON.stringify(extractedData)}\n`;
      }

      sampleCallsContext += `Transcript:\n${transcript.substring(0, 500)}${transcript.length > 500 ? '...' : ''}\n`;
    });
  }

  return `You are analyzing a voice AI agent configuration to generate an evaluation rubric.

AGENT CONFIGURATION:
Model: ${model}
Temperature: ${temperature}
Actions Available: ${actionNames}

AGENT PROMPT:
${prompt}
${sampleCallsContext}

TASK:
Generate 6-14 evaluation criteria that trace to the agent's actual instructions and observed behavior. Each criterion must be specific, measurable, and tied to something the agent was told to do or actions it commonly performs.

Use the sample calls above to understand:
- What actions the agent actually executes
- What data the agent typically extracts
- Common conversation patterns
- Real success and failure scenarios

CATEGORIES (use these exact values):
- data_collection: Extracting required information
- flow: Following conversational structure, transitions
- tone: Voice quality, professionalism, empathy
- objection: Handling pushback or concerns
- compliance: Legal disclaimers, required statements
- tools: Proper use of actions/tools

CHECK TYPES:
1. "deterministic" - Can be verified by examining transcript/actions directly
2. "llm" - Requires judgment (e.g., tone assessment, understanding intent)

CHECK SPEC GRAMMAR:
For deterministic checks, use ONE of these kinds:
- {"kind": "action_executed", "actionName": "send_email"}
- {"kind": "action_not_executed", "actionName": "transfer_call"}
- {"kind": "extracted_field", "field": "email", "required": true}
- {"kind": "agent_said_any", "phrases": ["hello", "hi there"]}
- {"kind": "agent_said_none", "forbiddenPhrases": ["um", "uh"]}
- {"kind": "duration_between", "minSeconds": 120, "maxSeconds": 600}

For LLM checks:
- {"kind": "llm", "question": "Did the agent maintain a professional tone?"}
  The question MUST be yes/no answerable.

SEVERITY LEVELS:
1 = Polish (nice to have)
2 = Important (affects customer experience)
3 = Critical (revenue impact, compliance, or deal-breaker)

VALIDATION RULES:
1. Return ONLY valid JSON (no markdown code blocks, no prose)
2. Each criterion must have: key, category, description, checkType, checkSpec, severity
3. Keys must be snake_case, unique, descriptive
4. Descriptions should be 1-2 sentences explaining what success looks like
5. Every criterion must trace to something in the agent's prompt/config
6. Don't invent requirements not in the prompt

OUTPUT FORMAT (return this exact structure):
{
  "criteria": [
    {
      "key": "greets_caller",
      "category": "flow",
      "description": "Agent greets the caller within first 10 seconds",
      "checkType": "deterministic",
      "checkSpec": {
        "kind": "agent_said_any",
        "phrases": ["hello", "hi", "good morning", "good afternoon", "good evening"]
      },
      "severity": 2,
      "enabled": true
    }
  ]
}

Generate the rubric now:`;
}

/**
 * Validate rubric data structure
 */
function validateRubricData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Rubric data must be an object');
  }

  if (!Array.isArray(data.criteria)) {
    throw new Error('Rubric must have a "criteria" array');
  }

  if (data.criteria.length < 6 || data.criteria.length > 14) {
    throw new Error(`Rubric must have 6-14 criteria, got ${data.criteria.length}`);
  }

  const validCategories = ['data_collection', 'flow', 'tone', 'objection', 'compliance', 'tools'];
  const validCheckTypes = ['deterministic', 'llm'];
  const validDeterministicKinds = [
    'action_executed',
    'action_not_executed',
    'extracted_field',
    'agent_said_any',
    'agent_said_none',
    'duration_between'
  ];

  const keys = new Set();

  for (let i = 0; i < data.criteria.length; i++) {
    const criterion = data.criteria[i];

    // Required fields
    if (!criterion.key) throw new Error(`Criterion ${i} missing "key"`);
    if (!criterion.category) throw new Error(`Criterion ${i} missing "category"`);
    if (!criterion.description) throw new Error(`Criterion ${i} missing "description"`);
    if (!criterion.checkType) throw new Error(`Criterion ${i} missing "checkType"`);
    if (!criterion.checkSpec) throw new Error(`Criterion ${i} missing "checkSpec"`);
    if (criterion.severity === undefined) throw new Error(`Criterion ${i} missing "severity"`);

    // Validate key uniqueness
    if (keys.has(criterion.key)) {
      throw new Error(`Duplicate criterion key: ${criterion.key}`);
    }
    keys.add(criterion.key);

    // Validate category
    if (!validCategories.includes(criterion.category)) {
      throw new Error(`Invalid category "${criterion.category}" in criterion ${i}`);
    }

    // Validate checkType
    if (!validCheckTypes.includes(criterion.checkType)) {
      throw new Error(`Invalid checkType "${criterion.checkType}" in criterion ${i}`);
    }

    // Validate severity
    if (![1, 2, 3].includes(criterion.severity)) {
      throw new Error(`Invalid severity ${criterion.severity} in criterion ${i}`);
    }

    // Validate checkSpec
    if (!criterion.checkSpec.kind) {
      throw new Error(`Criterion ${i} checkSpec missing "kind"`);
    }

    if (criterion.checkType === 'deterministic') {
      if (!validDeterministicKinds.includes(criterion.checkSpec.kind)) {
        throw new Error(`Invalid deterministic kind "${criterion.checkSpec.kind}" in criterion ${i}`);
      }

      // Validate kind-specific fields
      switch (criterion.checkSpec.kind) {
        case 'action_executed':
        case 'action_not_executed':
          if (!criterion.checkSpec.actionName) {
            throw new Error(`Criterion ${i} with kind ${criterion.checkSpec.kind} missing actionName`);
          }
          break;
        case 'extracted_field':
          if (!criterion.checkSpec.field) {
            throw new Error(`Criterion ${i} with kind extracted_field missing field`);
          }
          break;
        case 'agent_said_any':
          if (!Array.isArray(criterion.checkSpec.phrases) || criterion.checkSpec.phrases.length === 0) {
            throw new Error(`Criterion ${i} with kind agent_said_any missing phrases array`);
          }
          break;
        case 'agent_said_none':
          if (!Array.isArray(criterion.checkSpec.forbiddenPhrases) || criterion.checkSpec.forbiddenPhrases.length === 0) {
            throw new Error(`Criterion ${i} with kind agent_said_none missing forbiddenPhrases array`);
          }
          break;
        case 'duration_between':
          if (criterion.checkSpec.minSeconds === undefined || criterion.checkSpec.maxSeconds === undefined) {
            throw new Error(`Criterion ${i} with kind duration_between missing minSeconds or maxSeconds`);
          }
          break;
      }
    } else if (criterion.checkType === 'llm') {
      if (criterion.checkSpec.kind !== 'llm') {
        throw new Error(`Criterion ${i} has checkType "llm" but checkSpec.kind is not "llm"`);
      }
      if (!criterion.checkSpec.question) {
        throw new Error(`Criterion ${i} with kind llm missing question`);
      }
    }
  }
}

/**
 * Generate content hash for criteria (for caching)
 */
function generateContentHash(criteria) {
  const normalized = JSON.stringify(criteria, Object.keys(criteria).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Evaluate a call against a rubric
 * @param {string} callId - Call to evaluate
 * @param {UUID} rubricId - Rubric to evaluate against
 * @returns {Promise<{findingsCreated: number}>}
 */
export async function evaluateCall(callId, rubricId) {
  // Fetch call data
  const callResult = await db.query(
    `SELECT c.*,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'idx', ct.idx,
                'speaker', ct.speaker,
                'text', ct.text,
                'id', ct.id
              ) ORDER BY ct.idx)
              FROM call_turns ct
              WHERE ct.call_id = c.id AND ct.is_deleted = false),
              '[]'::json
            ) as turns
     FROM calls c
     WHERE c.id = $1 AND c.is_deleted = false`,
    [callId]
  );

  if (callResult.rows.length === 0) {
    throw new Error(`Call ${callId} not found`);
  }

  const call = callResult.rows[0];

  // Fetch rubric criteria
  const criteriaResult = await db.query(
    `SELECT id, key, category, description, check_type, check_spec, severity, enabled
     FROM rubric_criteria
     WHERE rubric_id = $1 AND is_deleted = false AND enabled = true
     ORDER BY severity DESC, category`,
    [rubricId]
  );

  const criteria = criteriaResult.rows;

  if (criteria.length === 0) {
    console.warn(`[Evaluation] No criteria found for rubric ${rubricId}`);
    return { findingsCreated: 0 };
  }

  let findingsCreated = 0;

  // Evaluate each criterion
  for (const criterion of criteria) {
    const finding = await evaluateCriterion(call, criterion);

    // Insert or update finding
    await db.query(
      `INSERT INTO findings (
        call_id, rubric_id, criterion_id, status, confidence, rationale, evidence_turn_ids, method
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (call_id, criterion_id, rubric_id) DO UPDATE
      SET status = $4, confidence = $5, rationale = $6, evidence_turn_ids = $7, method = $8, updated_at = NOW()`,
      [
        callId,
        rubricId,
        criterion.id,
        finding.status,
        finding.confidence,
        finding.rationale,
        finding.evidenceTurnIds,
        finding.method,
      ]
    );

    findingsCreated++;
  }

  console.log(`[Evaluation] Created ${findingsCreated} findings for call ${callId}`);

  return { findingsCreated };
}

/**
 * Evaluate a single criterion against a call
 */
async function evaluateCriterion(call, criterion) {
  const checkSpec = criterion.check_spec;

  if (criterion.check_type === 'deterministic') {
    return evaluateDeterministicCriterion(call, criterion, checkSpec);
  } else if (criterion.check_type === 'llm') {
    return evaluateLLMCriterion(call, criterion, checkSpec);
  } else {
    throw new Error(`Unknown check_type: ${criterion.check_type}`);
  }
}

/**
 * Evaluate deterministic criterion
 */
function evaluateDeterministicCriterion(call, criterion, checkSpec) {
  const kind = checkSpec.kind;
  const turns = Array.isArray(call.turns) ? call.turns : [];
  const executedActions = Array.isArray(call.executed_actions) ? call.executed_actions : [];
  const extractedData = call.extracted_data || {};

  let status = 'fail';
  let rationale = '';
  let evidenceTurnIds = [];

  switch (kind) {
    case 'action_executed': {
      const actionName = checkSpec.actionName;
      const found = executedActions.some(action =>
        action.name === actionName || action.action === actionName
      );
      status = found ? 'pass' : 'fail';
      rationale = found
        ? `Action "${actionName}" was executed`
        : `Action "${actionName}" was not executed`;
      break;
    }

    case 'action_not_executed': {
      const actionName = checkSpec.actionName;
      const found = executedActions.some(action =>
        action.name === actionName || action.action === actionName
      );
      status = found ? 'fail' : 'pass';
      rationale = found
        ? `Action "${actionName}" was executed (should not be)`
        : `Action "${actionName}" was not executed (as expected)`;
      break;
    }

    case 'extracted_field': {
      const field = checkSpec.field;
      const required = checkSpec.required !== false; // default true
      const hasField = extractedData[field] !== undefined && extractedData[field] !== null && extractedData[field] !== '';

      if (required) {
        status = hasField ? 'pass' : 'fail';
        rationale = hasField
          ? `Field "${field}" was extracted: ${extractedData[field]}`
          : `Required field "${field}" was not extracted`;
      } else {
        status = hasField ? 'pass' : 'na';
        rationale = hasField
          ? `Optional field "${field}" was extracted: ${extractedData[field]}`
          : `Optional field "${field}" was not extracted`;
      }
      break;
    }

    case 'agent_said_any': {
      const phrases = checkSpec.phrases || [];
      const agentTurns = turns.filter(t => t.speaker === 'agent');
      let foundPhrase = null;
      let foundTurn = null;

      for (const turn of agentTurns) {
        for (const phrase of phrases) {
          if (turn.text.toLowerCase().includes(phrase.toLowerCase())) {
            foundPhrase = phrase;
            foundTurn = turn;
            break;
          }
        }
        if (foundPhrase) break;
      }

      status = foundPhrase ? 'pass' : 'fail';
      rationale = foundPhrase
        ? `Agent said "${foundPhrase}" in conversation`
        : `Agent did not say any of: ${phrases.join(', ')}`;

      if (foundTurn) {
        evidenceTurnIds = [foundTurn.id];
      }
      break;
    }

    case 'agent_said_none': {
      const forbiddenPhrases = checkSpec.forbiddenPhrases || [];
      const agentTurns = turns.filter(t => t.speaker === 'agent');
      let foundForbidden = null;
      let foundTurn = null;

      for (const turn of agentTurns) {
        for (const phrase of forbiddenPhrases) {
          if (turn.text.toLowerCase().includes(phrase.toLowerCase())) {
            foundForbidden = phrase;
            foundTurn = turn;
            break;
          }
        }
        if (foundForbidden) break;
      }

      status = foundForbidden ? 'fail' : 'pass';
      rationale = foundForbidden
        ? `Agent said forbidden phrase "${foundForbidden}"`
        : `Agent avoided forbidden phrases: ${forbiddenPhrases.join(', ')}`;

      if (foundTurn) {
        evidenceTurnIds = [foundTurn.id];
      }
      break;
    }

    case 'duration_between': {
      const minSeconds = checkSpec.minSeconds || 0;
      const maxSeconds = checkSpec.maxSeconds || Infinity;
      const durationS = call.duration_s || 0;

      const withinRange = durationS >= minSeconds && durationS <= maxSeconds;
      status = withinRange ? 'pass' : 'fail';
      rationale = withinRange
        ? `Call duration ${durationS}s is within range ${minSeconds}-${maxSeconds}s`
        : `Call duration ${durationS}s is outside range ${minSeconds}-${maxSeconds}s`;
      break;
    }

    default:
      throw new Error(`Unknown deterministic kind: ${kind}`);
  }

  return {
    status,
    confidence: 1.0, // Deterministic checks are 100% confident
    rationale,
    evidenceTurnIds,
    method: 'deterministic',
  };
}

/**
 * Evaluate LLM-based criterion
 */
async function evaluateLLMCriterion(call, criterion, checkSpec) {
  const question = checkSpec.question;
  const turns = Array.isArray(call.turns) ? call.turns : [];
  const executedActions = Array.isArray(call.executed_actions) ? call.executed_actions : [];
  const extractedData = call.extracted_data || {};

  // Build transcript
  const transcript = turns
    .map(t => `${t.speaker.toUpperCase()}: ${t.text}`)
    .join('\n');

  // Build actions context
  let actionsContext = '';
  if (executedActions.length > 0) {
    actionsContext = '\n\nACTIONS EXECUTED:\n';
    executedActions.forEach((action, idx) => {
      actionsContext += `${idx + 1}. ${action.name || action.action || 'unknown'}`;
      if (action.parameters) {
        actionsContext += ` (params: ${JSON.stringify(action.parameters)})`;
      }
      actionsContext += '\n';
    });
  }

  // Build extracted data context
  let extractedDataContext = '';
  if (Object.keys(extractedData).length > 0) {
    extractedDataContext = '\n\nDATA EXTRACTED:\n';
    extractedDataContext += JSON.stringify(extractedData, null, 2);
  }

  // Build evaluation prompt
  const prompt = `You are evaluating a voice AI call against a specific criterion.

CRITERION: ${criterion.description}

CALL TRANSCRIPT:
${transcript}
${actionsContext}
${extractedDataContext}

EVALUATION QUESTION:
${question}

INSTRUCTIONS:
1. Read the transcript, actions executed, and extracted data carefully
2. Consider what the agent said AND what actions it performed
3. Answer the question with "yes" or "no"
4. Provide a confidence score (0.0 to 1.0)
5. Explain your reasoning in 1-2 sentences
6. If relevant, cite specific turn indices as evidence

OUTPUT FORMAT (return valid JSON):
{
  "answer": "yes",
  "confidence": 0.95,
  "reasoning": "The agent maintained a professional tone throughout...",
  "evidenceTurnIndices": [0, 3, 7]
}`;

  const result = await callLLM({
    prompt,
    systemPrompt: 'You are an expert at evaluating voice AI call quality. Be objective and precise.',
    stage: 'finding',
    refId: call.id,
    temperature: 0.1, // Very low for consistency
    maxTokens: 500,
  });

  // Parse response
  let evaluation;
  try {
    evaluation = JSON.parse(result.content);
  } catch (error) {
    console.error(`[Evaluation] Failed to parse LLM response for criterion ${criterion.key}:`, result.content);
    // Fallback to fail with low confidence
    return {
      status: 'fail',
      confidence: 0.0,
      rationale: 'LLM evaluation failed: could not parse response',
      evidenceTurnIds: [],
      method: 'llm',
    };
  }

  // Determine status
  const answer = (evaluation.answer || '').toLowerCase();
  const status = answer === 'yes' ? 'pass' : answer === 'no' ? 'fail' : 'na';
  const confidence = Math.max(0, Math.min(1, evaluation.confidence || 0.5));

  // Map turn indices to turn IDs
  const evidenceTurnIds = [];
  if (Array.isArray(evaluation.evidenceTurnIndices)) {
    for (const idx of evaluation.evidenceTurnIndices) {
      const turn = turns.find(t => t.idx === idx);
      if (turn) {
        evidenceTurnIds.push(turn.id);
      }
    }
  }

  return {
    status,
    confidence,
    rationale: evaluation.reasoning || 'No reasoning provided',
    evidenceTurnIds,
    method: 'llm',
  };
}

/**
 * Get rubric by agent version
 */
export async function getRubricByAgentVersion(agentVersionId) {
  const result = await db.query(
    `SELECT r.id, r.version, r.content_hash, r.created_at,
            (SELECT json_agg(json_build_object(
              'id', rc.id,
              'key', rc.key,
              'category', rc.category,
              'description', rc.description,
              'checkType', rc.check_type,
              'checkSpec', rc.check_spec,
              'severity', rc.severity,
              'enabled', rc.enabled
            ) ORDER BY rc.severity DESC, rc.category)
            FROM rubric_criteria rc
            WHERE rc.rubric_id = r.id AND rc.is_deleted = false) as criteria
     FROM rubrics r
     WHERE r.agent_version_id = $1 AND r.is_deleted = false
     ORDER BY r.version DESC
     LIMIT 1`,
    [agentVersionId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Evaluate multiple calls in parallel with concurrency control
 * Used by job queue for batch processing
 */
export async function evaluateCallsBatch(callIds, rubricId, options = {}) {
  const { concurrency = 5 } = options;

  // Dynamic import p-limit for concurrency control
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  const results = await Promise.all(
    callIds.map(callId =>
      limit(async () => {
        try {
          const result = await evaluateCall(callId, rubricId);
          return { callId, success: true, ...result };
        } catch (error) {
          return { callId, success: false, error: error.message };
        }
      })
    )
  );

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    total: callIds.length,
    succeeded,
    failed,
    results,
  };
}

export default {
  generateRubricForAgentVersion,
  evaluateCall,
  evaluateCallsBatch,
  getRubricByAgentVersion,
};
