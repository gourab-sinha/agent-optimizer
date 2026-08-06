/**
 * Propose - LLM-based recommendation generation
 *
 * Takes assembled input context and generates 2-6 recommendations
 * using a single LLM call with temperature 0.3
 */

import { callLLM } from '../services/llmService.js';

/**
 * Build the system prompt for recommendation generation
 */
function buildSystemPrompt() {
  return `You are an AI agent optimizer. Generate 2-6 configuration fix recommendations based on the patterns and test failures provided.

Return a JSON array of recommendation objects. Each recommendation must have:
- recType: one of the valid types (action_update, action_add, prompt_patch, etc.)
- payload: object with fields specific to the recType
- rationale: explanation of the issue and fix
- linkedPatternIds: array of pattern UUIDs being addressed
- expectedCriterionIds: array of criterion UUIDs expected to improve
- supportingTestCaseIds: array of test case UUIDs (can be empty)

PAYLOAD STRUCTURES BY TYPE:

1. action_update - Update an existing action's configuration:
{
  "actionId": "UUID of action to update (get from Actions list)",
  "changes": {
    "actionName": "optional new name",
    "instructions": "updated instructions for when/how to use this action",
    "actionParameters": {"param": "value"}
  }
}

2. action_add - Add a new action capability:
{
  "actionType": "type from constraints.actionTypes (e.g., WORKFLOW_TRIGGER, APPOINTMENT_BOOKING)",
  "actionName": "descriptive name for this action",
  "instructions": "when and how the agent should use this action",
  "actionParameters": {"param": "value"}
}

3. prompt_patch - Replace the entire agent prompt:
{
  "newPrompt": "the COMPLETE new prompt text - preserve all working parts, only fix what patterns indicate is broken"
}

KEY RULES:
- Fix tool failures with action_update/action_add, not prompt changes
- Use only IDs from the provided data (patterns, criteria, actions, test cases)
- Return a JSON array even for a single recommendation
- Maximum one prompt_patch per response

Example:
[
  {
    "recType": "action_update",
    "payload": {
      "actionId": "abc-123-def-456",
      "changes": {
        "instructions": "Use this when caller confirms a specific appointment time. Check availability first, then book only if slots exist."
      }
    },
    "rationale": "Pattern 'uses_appointment_booking_action_when_slots_exist' shows the booking action fails to execute 15/20 times even when the agent discusses scheduling. This update makes the booking action trigger conditions explicit, which should improve execution reliability.",
    "linkedPatternIds": ["pattern-uuid-1"],
    "expectedCriterionIds": ["criterion-uuid-1", "criterion-uuid-2"],
    "supportingTestCaseIds": []
  }
]`;
}

/**
 * Build the user prompt with all input context
 */
function buildUserPrompt(input) {
  const { agent, patterns, testResults, constraints } = input;

  // Format patterns section
  const patternsText = patterns.map(p => {
    const evidenceText = p.evidence.length > 0
      ? `\nEvidence examples:\n${p.evidence.map((e, i) => `  ${i + 1}. "${e}"`).join('\n')}`
      : '';

    return `Pattern "${p.id}":
  Title: ${p.title}
  Description: ${p.description}
  Criterion: ${p.criterionKey}
  Impact: ${p.failCount}/${p.callCount} calls (score: ${p.impactScore.toFixed(2)})${evidenceText}`;
  }).join('\n\n');

  // Format test results section
  let testResultsText = 'No test results available yet.';
  if (testResults) {
    const failingCases = testResults.cases.filter(c => c.passRate < 1);
    if (failingCases.length > 0) {
      testResultsText = `Test Run ${testResults.runId} (${testResults.runsPerCase} runs per case):

${failingCases.map(c => {
  const failedCriteriaText = c.failedCriteria.length > 0
    ? `\n  Failed criteria:\n${c.failedCriteria.map(fc =>
        `    - ${fc.key} (${fc.criterionId}): ${fc.exampleRationale}`
      ).join('\n')}`
    : '';

  return `Test Case "${c.id}":
  Title: ${c.title}
  Pass Rate: ${(c.passRate * 100).toFixed(0)}%${c.flaky ? ' (FLAKY)' : ''}${c.seededByPatternId ? `\n  Seeded by pattern: ${c.seededByPatternId}` : ''}${failedCriteriaText}`;
}).join('\n\n')}`;
    } else {
      testResultsText = `Test Run ${testResults.runId}: All ${testResults.cases.length} test cases passing.`;
    }
  }

  // Format actions
  const actionsText = agent.actions.length > 0
    ? agent.actions.map(a =>
        `  - ${a.actionType} (${a.actionId}): ${a.actionName}`
      ).join('\n')
    : '  (no actions configured)';

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

Transfer Numbers: ${agent.transferNumbers && agent.transferNumbers.length > 0 ? agent.transferNumbers.join(', ') : 'none'}

Actions:
${actionsText}

================================================================================

RECURRING ISSUES (Top by Impact):
${patternsText}

================================================================================

TEST RESULTS:
${testResultsText}

================================================================================

CONSTRAINTS:
Valid recTypes: ${constraints.recTypes.join(', ')}
Valid actionTypes: ${constraints.actionTypes.join(', ')}
Available criteria (key: id):
${Object.entries(constraints.criterionIds).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

================================================================================

Generate 2-6 recommendations based on the evidence above. Return ONLY the JSON array.`;
}

/**
 * Generate recommendations via LLM
 *
 * @param {Object} input - Assembled input context
 * @returns {Promise<Array>} Array of raw LLM proposals
 */
export async function proposeRecommendations(input) {
  console.log('\n🤖 Generating recommendations via LLM...');

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(input);

  const result = await callLLM({
    prompt: userPrompt,
    systemPrompt,
    stage: 'recommend',
    temperature: 0.3,
    maxTokens: 16000, // Increased to handle longer responses with prompt_patch
    // responseFormat: 'json' - disabled, too strict
  });

  console.log(`   ✓ LLM call complete (${result.usage.completionTokens} tokens)`);

  // Parse JSON response
  let proposals;
  try {
    // Remove markdown code fences if present
    let cleaned = result.content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
    }

    proposals = JSON.parse(cleaned);

    // Handle different response formats
    if (proposals.recommendations && Array.isArray(proposals.recommendations)) {
      // OpenAI wrapped it in a recommendations key
      console.log('   ℹ️  Extracting recommendations from wrapped response');
      proposals = proposals.recommendations;
    } else if (!Array.isArray(proposals)) {
      // Single object, wrap it
      console.warn('   ⚠️  LLM returned single object instead of array, wrapping it');
      proposals = [proposals];
    }

    console.log(`   ✓ Parsed ${proposals.length} proposal(s)`);
    return proposals;

  } catch (err) {
    console.error('   ✗ Failed to parse LLM response:', err.message);
    console.error('   Raw response:', result.content);
    throw new Error(`LLM returned invalid JSON: ${err.message}`);
  }
}
