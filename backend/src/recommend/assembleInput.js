/**
 * Assemble Input - Gather context for recommendation proposal
 *
 * Builds one context object containing:
 * - Current agent configuration (prompt, actions, settings)
 * - Top patterns by impact score
 * - Latest test run results
 * - Constraints (valid recTypes, actionTypes, criterionIds)
 */

import db from '../db/connection.js';
import { getRecTypeKeys, GHL_ACTION_TYPES } from './recTypes.js';

/**
 * Truncate text to maximum length
 */
function truncate(text, maxLen = 240) {
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

/**
 * Get agent configuration and actions from agent_version
 */
async function getAgentConfig(agentVersionId) {
  const result = await db.query(
    `SELECT id, agent_id, config, actions
     FROM agent_versions
     WHERE id = $1 AND is_deleted = false`,
    [agentVersionId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Agent version ${agentVersionId} not found`);
  }

  const version = result.rows[0];
  const config = version.config || {};
  const actions = version.actions || [];

  return {
    agentId: version.agent_id,
    // Core prompt and messages
    prompt: config.agentPrompt || '',
    welcomeMessage: config.welcomeMessage || '',

    // Model configuration
    model: config.model || '',
    temperature: config.temperature !== undefined ? config.temperature : null,

    // Call behavior settings
    patienceLevel: config.patienceLevel || 'medium',
    maxCallDuration: config.maxCallDuration || 600,
    endCallFunctionEnabled: config.endCallFunctionEnabled || false,

    // Voice and language
    voiceId: config.voiceId || '',
    language: config.language || '',

    // Knowledge base
    knowledgeBase: config.knowledgeBase || null,

    // Transfer settings
    transferNumbers: config.transferNumbers || [],

    // Actions
    actions: actions.map(a => ({
      actionId: a.id || a.actionId, // HighLevel uses 'id', internal uses 'actionId'
      actionType: a.actionType,
      actionName: a.name || a.actionName,
      actionParameters: a.actionParameters || {}
    })),

    // Additional settings that might be useful
    recordingEnabled: config.recordingEnabled !== undefined ? config.recordingEnabled : true,
    enableVoicemailDetection: config.enableVoicemailDetection || false,
    waitForGreeting: config.waitForGreeting || false
  };
}

/**
 * Get top patterns by impact score
 */
async function getTopPatterns(agentVersionId, limit = 6) {
  const result = await db.query(
    `SELECT
       p.id,
       p.title,
       p.description,
       p.fail_count,
       p.call_count,
       p.impact_score,
       c.key as criterion_key,
       p.representative_finding_ids
     FROM issue_patterns p
     JOIN rubric_criteria c ON p.criterion_id = c.id
     WHERE p.agent_version_id = $1
       AND p.is_deleted = false
     ORDER BY p.impact_score DESC
     LIMIT $2`,
    [agentVersionId, limit]
  );

  // Get evidence turns for each pattern
  const patterns = await Promise.all(
    result.rows.map(async (pattern) => {
      const findingIds = pattern.representative_finding_ids || [];

      // Get up to 3 evidence turns
      if (findingIds.length === 0) {
        return {
          id: pattern.id,
          title: pattern.title,
          description: pattern.description,
          criterionKey: pattern.criterion_key,
          failCount: pattern.fail_count,
          callCount: pattern.call_count,
          impactScore: pattern.impact_score,
          evidence: []
        };
      }

      const evidenceResult = await db.query(
        `SELECT f.evidence_turn_ids
         FROM findings f
         WHERE f.id = ANY($1::uuid[])
           AND f.is_deleted = false
         LIMIT 3`,
        [findingIds.slice(0, 3)]
      );

      const turnIds = evidenceResult.rows
        .flatMap(row => row.evidence_turn_ids || [])
        .slice(0, 3);

      if (turnIds.length === 0) {
        return {
          id: pattern.id,
          title: pattern.title,
          description: pattern.description,
          criterionKey: pattern.criterion_key,
          failCount: pattern.fail_count,
          callCount: pattern.call_count,
          impactScore: pattern.impact_score,
          evidence: []
        };
      }

      const turnsResult = await db.query(
        `SELECT text
         FROM call_turns
         WHERE id = ANY($1::text[])
           AND is_deleted = false`,
        [turnIds]
      );

      return {
        id: pattern.id,
        title: pattern.title,
        description: pattern.description,
        criterionKey: pattern.criterion_key,
        failCount: pattern.fail_count,
        callCount: pattern.call_count,
        impactScore: pattern.impact_score,
        evidence: turnsResult.rows.map(t => truncate(t.text, 240))
      };
    })
  );

  return patterns;
}

/**
 * Get latest completed test run and its results
 */
async function getTestResults(agentVersionId) {
  // Get latest completed test run
  const runResult = await db.query(
    `SELECT id, runs_per_case
     FROM test_runs
     WHERE agent_version_id = $1
       AND status = 'completed'
       AND is_deleted = false
     ORDER BY finished_at DESC
     LIMIT 1`,
    [agentVersionId]
  );

  if (runResult.rows.length === 0) {
    return null; // No completed test runs yet
  }

  const testRun = runResult.rows[0];

  // Get test results for this run
  const resultsQuery = await db.query(
    `SELECT
       tr.test_case_id,
       tc.title,
       tc.seeded_by_pattern_id,
       tr.passed,
       tr.criterion_outcomes
     FROM test_results tr
     JOIN test_cases tc ON tr.test_case_id = tc.id
     WHERE tr.test_run_id = $1
       AND tr.is_deleted = false
       AND tc.is_deleted = false`,
    [testRun.id]
  );

  // Group by test case and calculate pass rates
  const caseMap = {};
  for (const row of resultsQuery.rows) {
    if (!caseMap[row.test_case_id]) {
      caseMap[row.test_case_id] = {
        id: row.test_case_id,
        title: row.title,
        seededByPatternId: row.seeded_by_pattern_id,
        attempts: [],
        criteriaFailures: new Map()
      };
    }

    caseMap[row.test_case_id].attempts.push(row.passed);

    // Track failed criteria across attempts
    if (!row.passed && row.criterion_outcomes) {
      for (const [criterionId, outcome] of Object.entries(row.criterion_outcomes)) {
        if (outcome.status === 'fail') {
          if (!caseMap[row.test_case_id].criteriaFailures.has(criterionId)) {
            caseMap[row.test_case_id].criteriaFailures.set(criterionId, {
              criterionId,
              key: outcome.key || 'unknown',
              rationales: []
            });
          }
          caseMap[row.test_case_id].criteriaFailures.get(criterionId).rationales.push(
            outcome.rationale || ''
          );
        }
      }
    }
  }

  const cases = Object.values(caseMap).map(c => {
    const passCount = c.attempts.filter(p => p).length;
    const totalAttempts = c.attempts.length;
    const passRate = totalAttempts > 0 ? passCount / totalAttempts : 0;
    const flaky = passCount > 0 && passCount < totalAttempts;

    const failedCriteria = Array.from(c.criteriaFailures.values()).map(fc => ({
      criterionId: fc.criterionId,
      key: fc.key,
      exampleRationale: fc.rationales[0] || ''
    }));

    return {
      id: c.id,
      title: c.title,
      seededByPatternId: c.seededByPatternId,
      passRate,
      flaky,
      failedCriteria
    };
  });

  return {
    runId: testRun.id,
    runsPerCase: testRun.runs_per_case,
    cases
  };
}

/**
 * Get criterion IDs map for constraints
 */
async function getCriterionIds(agentVersionId) {
  const result = await db.query(
    `SELECT c.id, c.key
     FROM rubric_criteria c
     JOIN rubrics r ON c.rubric_id = r.id
     WHERE r.agent_version_id = $1
       AND r.is_deleted = false
       AND c.is_deleted = false
       AND c.enabled = true`,
    [agentVersionId]
  );

  const map = {};
  for (const row of result.rows) {
    map[row.key] = row.id;
  }
  return map;
}

/**
 * Assemble complete input context for proposal generation
 *
 * @param {string} agentVersionId - Agent version UUID
 * @returns {Promise<Object>} Complete context object
 */
export async function assembleInput(agentVersionId) {
  console.log(`\n📋 Assembling input for agent version ${agentVersionId}`);

  const [agent, patterns, testResults, criterionIds] = await Promise.all([
    getAgentConfig(agentVersionId),
    getTopPatterns(agentVersionId, 6),
    getTestResults(agentVersionId),
    getCriterionIds(agentVersionId)
  ]);

  console.log(`   ✓ Agent config: model=${agent.model || 'default'}, temp=${agent.temperature ?? 'default'}, ${agent.actions.length} actions, KB=${agent.knowledgeBase ? 'yes' : 'no'}`);
  console.log(`   ✓ Patterns: ${patterns.length} (top by impact)`);
  console.log(`   ✓ Test results: ${testResults ? testResults.cases.length + ' cases' : 'none yet'}`);
  console.log(`   ✓ Criteria: ${Object.keys(criterionIds).length} enabled`);

  return {
    agent,
    patterns,
    testResults,
    constraints: {
      recTypes: getRecTypeKeys(),
      actionTypes: GHL_ACTION_TYPES,
      criterionIds
    }
  };
}
