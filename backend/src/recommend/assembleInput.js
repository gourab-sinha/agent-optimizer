/**
 * Assemble Input - Rich context for recommendation proposal
 *
 * Builds:
 * - Agent configuration (prompt, settings, full actions)
 * - Top patterns with finding rationales + evidence turns
 * - Latest test run results
 * - Prior open recommendations (dedupe / avoid repeats)
 * - Constraints + readiness gate
 */

import db from '../db/connection.js';
import { getRecTypeKeys, GHL_ACTION_TYPES, buildRecTypeCatalog } from './recTypes.js';

function truncate(text, maxLen = 240) {
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

/**
 * Map HighLevel / internal action shapes to a rich view for the LLM
 */
function mapAction(a) {
  return {
    actionId: a.id || a.actionId,
    actionType: a.actionType,
    actionName: a.name || a.actionName || a.action_name || 'unnamed',
    instructions:
      a.instructions ||
      a.actionParameters?.instructions ||
      a.parameters?.instructions ||
      '',
    actionParameters: a.actionParameters || a.parameters || {},
  };
}

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
    prompt: config.agentPrompt || config.prompt || '',
    welcomeMessage: config.welcomeMessage || '',
    model: config.model || '',
    temperature: config.temperature !== undefined ? config.temperature : null,
    patienceLevel: config.patienceLevel || 'medium',
    maxCallDuration: config.maxCallDuration || 600,
    endCallFunctionEnabled: config.endCallFunctionEnabled || false,
    voiceId: config.voiceId || '',
    language: config.language || '',
    knowledgeBase: config.knowledgeBase || null,
    transferNumbers: config.transferNumbers || [],
    actions: actions.map(mapAction),
    recordingEnabled:
      config.recordingEnabled !== undefined ? config.recordingEnabled : true,
    enableVoicemailDetection: config.enableVoicemailDetection || false,
    waitForGreeting: config.waitForGreeting || false,
  };
}

/**
 * Top patterns with criterion metadata, rationales, and turn evidence
 */
async function getTopPatterns(agentVersionId, limit = 10) {
  const result = await db.query(
    `SELECT
       p.id,
       p.title,
       p.description,
       p.fail_count,
       p.call_count,
       p.impact_score,
       p.criterion_id,
       c.key as criterion_key,
       c.severity as criterion_severity,
       c.category as criterion_category,
       p.representative_finding_ids
     FROM issue_patterns p
     JOIN rubric_criteria c ON p.criterion_id = c.id
     WHERE p.agent_version_id = $1
       AND p.is_deleted = false
     ORDER BY p.impact_score DESC
     LIMIT $2`,
    [agentVersionId, limit]
  );

  const patterns = await Promise.all(
    result.rows.map(async (pattern) => {
      const findingIds = pattern.representative_finding_ids || [];
      let rationales = [];
      let evidence = [];

      if (findingIds.length > 0) {
        const findingsResult = await db.query(
          `SELECT id, rationale, confidence, evidence_turn_ids, status
           FROM findings
           WHERE id = ANY($1::uuid[])
             AND is_deleted = false
           ORDER BY confidence DESC NULLS LAST
           LIMIT 5`,
          [findingIds.slice(0, 5)]
        );

        rationales = findingsResult.rows
          .map((f) => truncate(f.rationale || '', 320))
          .filter(Boolean);

        const turnIds = findingsResult.rows
          .flatMap((row) => row.evidence_turn_ids || [])
          .slice(0, 5);

        if (turnIds.length > 0) {
          const turnsResult = await db.query(
            `SELECT text, speaker
             FROM call_turns
             WHERE id = ANY($1::text[])
               AND is_deleted = false`,
            [turnIds]
          );
          evidence = turnsResult.rows.map((t) =>
            truncate(
              `${t.speaker ? t.speaker.toUpperCase() + ': ' : ''}${t.text}`,
              240
            )
          );
        }
      }

      return {
        id: pattern.id,
        title: pattern.title,
        description: pattern.description,
        criterionId: pattern.criterion_id,
        criterionKey: pattern.criterion_key,
        criterionSeverity: pattern.criterion_severity,
        criterionCategory: pattern.criterion_category,
        failCount: pattern.fail_count,
        callCount: pattern.call_count,
        impactScore: Number(pattern.impact_score) || 0,
        rationales,
        evidence,
      };
    })
  );

  return patterns;
}

async function getTestResults(agentVersionId) {
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
    return null;
  }

  const testRun = runResult.rows[0];

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

  const caseMap = {};
  for (const row of resultsQuery.rows) {
    if (!caseMap[row.test_case_id]) {
      caseMap[row.test_case_id] = {
        id: row.test_case_id,
        title: row.title,
        seededByPatternId: row.seeded_by_pattern_id,
        attempts: [],
        criteriaFailures: new Map(),
      };
    }

    caseMap[row.test_case_id].attempts.push(row.passed);

    if (!row.passed && row.criterion_outcomes) {
      for (const [criterionId, outcome] of Object.entries(
        row.criterion_outcomes
      )) {
        if (outcome.status === 'fail') {
          if (!caseMap[row.test_case_id].criteriaFailures.has(criterionId)) {
            caseMap[row.test_case_id].criteriaFailures.set(criterionId, {
              criterionId,
              key: outcome.key || 'unknown',
              rationales: [],
            });
          }
          caseMap[row.test_case_id].criteriaFailures
            .get(criterionId)
            .rationales.push(outcome.rationale || '');
        }
      }
    }
  }

  const cases = Object.values(caseMap).map((c) => {
    const passCount = c.attempts.filter((p) => p).length;
    const totalAttempts = c.attempts.length;
    const passRate = totalAttempts > 0 ? passCount / totalAttempts : 0;
    const flaky = passCount > 0 && passCount < totalAttempts;

    const failedCriteria = Array.from(c.criteriaFailures.values()).map(
      (fc) => ({
        criterionId: fc.criterionId,
        key: fc.key,
        exampleRationale: fc.rationales[0] || '',
      })
    );

    return {
      id: c.id,
      title: c.title,
      seededByPatternId: c.seededByPatternId,
      passRate,
      flaky,
      failedCriteria,
    };
  });

  const failing = cases.filter((c) => c.passRate < 1);
  const passing = cases.filter((c) => c.passRate === 1);

  return {
    runId: testRun.id,
    runsPerCase: testRun.runs_per_case,
    cases,
    summary: {
      total: cases.length,
      failing: failing.length,
      passing: passing.length,
      overallPassRate:
        cases.length > 0
          ? cases.reduce((s, c) => s + c.passRate, 0) / cases.length
          : null,
    },
  };
}

async function getCriterionIds(agentVersionId) {
  const result = await db.query(
    `SELECT c.id, c.key, c.severity, c.category, c.description
     FROM rubric_criteria c
     JOIN rubrics r ON c.rubric_id = r.id
     WHERE r.agent_version_id = $1
       AND r.is_deleted = false
       AND c.is_deleted = false
       AND c.enabled = true`,
    [agentVersionId]
  );

  const map = {};
  const details = {};
  for (const row of result.rows) {
    map[row.key] = row.id;
    details[row.id] = {
      key: row.key,
      severity: row.severity,
      category: row.category,
      description: row.description,
    };
  }
  return { map, details };
}

/**
 * Open recommendations already proposed for this version (avoid repeats)
 */
async function getPriorRecommendations(agentVersionId, limit = 15) {
  const result = await db.query(
    `SELECT id, rec_type, rationale, status, payload, linked_pattern_ids
     FROM recommendations
     WHERE agent_version_id = $1
       AND is_deleted = false
       AND status IN ('proposed', 'accepted', 'applied', 'verified_up')
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentVersionId, limit]
  );

  return result.rows.map((r) => ({
    id: r.id,
    recType: r.rec_type,
    status: r.status,
    rationale: truncate(r.rationale || '', 160),
    linkedPatternIds: r.linked_pattern_ids || [],
    payloadSummary: truncate(JSON.stringify(r.payload || {}), 120),
  }));
}

/**
 * Readiness gate — whether we have enough signal to generate
 */
function assessReadiness(patterns, testResults, criterionIds) {
  const reasons = [];
  const warnings = [];

  if (Object.keys(criterionIds).length === 0) {
    reasons.push('No enabled rubric criteria — generate a rubric first');
  }
  if (patterns.length === 0) {
    reasons.push('No issue patterns — run pattern detection first');
  }

  if (!testResults) {
    warnings.push(
      'No completed test runs — recommendations will be pattern-only (unverified)'
    );
  } else if (testResults.summary?.failing === 0) {
    warnings.push(
      'All tests currently passing — recommendations may be low priority'
    );
  }

  const thinEvidence = patterns.filter(
    (p) => (p.rationales?.length || 0) === 0 && (p.evidence?.length || 0) === 0
  );
  if (thinEvidence.length > 0 && patterns.length > 0) {
    warnings.push(
      `${thinEvidence.length} pattern(s) lack finding rationales/evidence`
    );
  }

  return {
    canGenerate: reasons.length === 0,
    reasons,
    warnings,
    mode: testResults ? 'patterns+tests' : 'patterns-only',
  };
}

/**
 * Assemble complete input context
 *
 * @param {string} agentVersionId
 * @param {Object} [options]
 * @param {number} [options.patternLimit=6]
 * @returns {Promise<Object>}
 */
export async function assembleInput(agentVersionId, options = {}) {
  const patternLimit = options.patternLimit ?? 10;

  console.log(`\n📋 Assembling input for agent version ${agentVersionId}`);

  const [agent, patterns, testResults, criteria, priorRecommendations] =
    await Promise.all([
      getAgentConfig(agentVersionId),
      getTopPatterns(agentVersionId, patternLimit),
      getTestResults(agentVersionId),
      getCriterionIds(agentVersionId),
      getPriorRecommendations(agentVersionId),
    ]);

  const readiness = assessReadiness(patterns, testResults, criteria.map);

  console.log(
    `   ✓ Agent: model=${agent.model || 'default'}, actions=${agent.actions.length}, prompt=${agent.prompt.length} chars`
  );
  console.log(`   ✓ Patterns: ${patterns.length}`);
  console.log(
    `   ✓ Tests: ${testResults ? testResults.cases.length + ' cases' : 'none'}`
  );
  console.log(`   ✓ Prior recs: ${priorRecommendations.length}`);
  console.log(
    `   ✓ Readiness: ${readiness.canGenerate ? 'OK' : 'BLOCKED'} (${readiness.mode})`
  );

  return {
    agentVersionId,
    agent,
    patterns,
    testResults,
    priorRecommendations,
    readiness,
    constraints: {
      recTypes: getRecTypeKeys(),
      actionTypes: GHL_ACTION_TYPES,
      criterionIds: criteria.map,
      criterionDetails: criteria.details,
      recTypeCatalog: buildRecTypeCatalog(),
    },
  };
}
