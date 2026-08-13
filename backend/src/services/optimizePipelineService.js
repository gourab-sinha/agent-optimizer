import db from '../db/connection.js';
import { syncAllAgents } from './agentSyncService.js';
import { syncAgentCalls, getAgentCalls } from './callSyncService.js';
import {
  generateRubricForAgentVersion,
  evaluateCall,
  getRubricByAgentVersion,
} from './rubricEvaluationService.js';
import { detectPatterns } from './patternDetectionService.js';
import { generateTestCases, getTestCases } from './testGenerationService.js';
import { runTests, getTestResults } from './testRunnerService.js';
import { generateRecommendations } from '../recommend/index.js';

const STEPS = [
  'sync_agent',
  'sync_calls',
  'rubric',
  'evaluate',
  'patterns',
  'tests',
  'run',
  'recs',
];

export function listOptimizeSteps() {
  return STEPS;
}

export async function getOptimizeStatus(agentId) {
  if (!agentId) {
    throw Object.assign(new Error('agentId is required'), { status: 400 });
  }

  const versionResult = await db.query(
    `SELECT id, label, source, created_at
     FROM agent_versions
     WHERE agent_id = $1 AND is_deleted = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [agentId]
  );
  const version = versionResult.rows[0] || null;

  if (!version) {
    return {
      version: null,
      optimized: false,
      lastOptimizedAt: null,
      patternCount: 0,
      recommendationCount: 0,
      calls: [],
      rubric: null,
      testCases: [],
      patterns: [],
      recommendations: [],
      lastRun: null,
      lastRunResults: [],
      lastRunMetrics: null,
    };
  }

  const [patternsResult, recsResult, runResult, calls, testCases, rubric] = await Promise.all([
    db.query(
      `SELECT id, title, description, fail_count, call_count, impact_score, criterion_id
       FROM issue_patterns
       WHERE agent_version_id = $1 AND is_deleted = false
       ORDER BY impact_score DESC
       LIMIT 20`,
      [version.id]
    ),
    db.query(
      `SELECT id, rec_type, tier, rationale, payload, status, created_at
       FROM recommendations
       WHERE agent_version_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 20`,
      [version.id]
    ),
    db.query(
      `SELECT id, status, trigger, started_at, finished_at, created_at
       FROM test_runs
       WHERE agent_version_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [version.id]
    ),
    getAgentCalls(agentId, { limit: 50 }),
    getTestCases(agentId),
    getRubricByAgentVersion(version.id),
  ]);

  const lastRun = runResult.rows[0] || null;
  const lastOptimizedAt = recsResult.rows[0]?.created_at || lastRun?.finished_at || lastRun?.created_at || null;
  const lastRunResults = lastRun ? await getTestResults(lastRun.id) : [];
  const passed = lastRunResults.filter((row) => row.passed).length;
  const total = lastRunResults.length;
  const lastRunMetrics = lastRun ? {
    total,
    passed,
    failed: total - passed,
    passRate: total ? Number(((passed / total) * 100).toFixed(1)) : 0,
    status: lastRun.status,
    startedAt: lastRun.started_at,
    finishedAt: lastRun.finished_at,
  } : null;

  return {
    version: {
      id: version.id,
      label: version.label,
      source: version.source,
      createdAt: version.created_at,
    },
    optimized: recsResult.rows.length > 0 || lastRun?.status === 'completed',
    lastOptimizedAt,
    patternCount: patternsResult.rows.length,
    recommendationCount: recsResult.rows.length,
    calls,
    rubric,
    testCases,
    patterns: patternsResult.rows,
    recommendations: recsResult.rows.map((row) => ({
      id: row.id,
      recType: row.rec_type,
      tier: row.tier,
      rationale: row.rationale,
      payload: row.payload,
      status: row.status,
      createdAt: row.created_at,
    })),
    lastRun,
    lastRunResults,
    lastRunMetrics,
  };
}

async function latestVersionId(agentId) {
  const result = await db.query(
    `SELECT id FROM agent_versions
     WHERE agent_id = $1 AND is_deleted = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [agentId]
  );
  return result.rows[0]?.id || null;
}

async function ensureLocationToken(companyId, locationId) {
  if (!companyId || !locationId) return;
  try {
    const { ensureLocationFromCompany } = await import('../ghl/companyAuth.js');
    await ensureLocationFromCompany(companyId, locationId);
  } catch (error) {
    console.error('Optimize pipeline: location mint failed', error.response?.data || error.message);
  }
}

/**
 * Run one stage of the Optimize pipeline so the UI can show real progress.
 */
export async function runOptimizeStep({
  agentId,
  locationId,
  companyId,
  step,
  testCaseIds,
} = {}) {
  if (!agentId) {
    throw Object.assign(new Error('agentId is required'), { status: 400 });
  }
  if (!STEPS.includes(step)) {
    throw Object.assign(new Error(`Unknown optimize step: ${step}`), { status: 400 });
  }

  if (step === 'sync_agent') {
    if (locationId) {
      await ensureLocationToken(companyId, locationId);
      const agents = await syncAllAgents(locationId);
      return { step, agentCount: agents.length };
    }
    return { step, skipped: true, reason: 'missing_location' };
  }

  if (step === 'sync_calls') {
    if (!locationId) {
      const existing = await getAgentCalls(agentId, { limit: 50 });
      return {
        step,
        count: existing.length,
        calls: existing,
        blocked: existing.length === 0,
        reason: existing.length === 0 ? 'no_calls' : undefined,
      };
    }
    await ensureLocationToken(companyId, locationId);
    const calls = await syncAgentCalls(locationId, agentId);
    return {
      step,
      count: calls.length,
      calls,
      blocked: calls.length === 0,
      reason: calls.length === 0 ? 'no_calls' : undefined,
    };
  }

  if (step === 'rubric') {
    const versionId = await latestVersionId(agentId);
    if (!versionId) {
      throw Object.assign(new Error('Agent is not synced yet. Sync the agent first.'), { status: 404 });
    }
    const result = await generateRubricForAgentVersion(versionId);
    const rubric = await getRubricByAgentVersion(versionId);
    return {
      step,
      versionId,
      rubricId: result.rubricId,
      criteriaCount: result.criteriaCount,
      cached: !!result.cached,
      rubric,
    };
  }

  if (step === 'evaluate') {
    const versionId = await latestVersionId(agentId);
    if (!versionId) {
      throw Object.assign(new Error('No agent version found'), { status: 404 });
    }
    const rubric = await getRubricByAgentVersion(versionId);
    if (!rubric) {
      throw Object.assign(new Error('No rubric found. Build the rubric first.'), { status: 404 });
    }
    const calls = await getAgentCalls(agentId, { limit: 50 });
    if (!calls.length) {
      return { step, blocked: true, reason: 'no_calls', evaluated: 0 };
    }
    const results = [];
    for (const call of calls) {
      try {
        const evaluated = await evaluateCall(call.id, rubric.id);
        results.push({ callId: call.id, findingsCreated: evaluated.findingsCreated, success: true });
      } catch (error) {
        results.push({ callId: call.id, success: false, error: error.message });
      }
    }
    return { step, rubricId: rubric.id, evaluated: results.length, results, calls };
  }

  if (step === 'patterns') {
    const versionId = await latestVersionId(agentId);
    const rubric = versionId ? await getRubricByAgentVersion(versionId) : null;
    if (!rubric) {
      throw Object.assign(new Error('No rubric found. Analyze calls first.'), { status: 404 });
    }
    const result = await detectPatterns(rubric.id, { minFailCount: 1, minImpactScore: 0.1 });
    return {
      step,
      rubricId: rubric.id,
      patternCount: result.patterns?.length || 0,
      patterns: result.patterns || [],
    };
  }

  if (step === 'tests') {
    const generated = await generateTestCases(agentId);
    const testCases = await getTestCases(agentId);
    return {
      step,
      totalCases: generated.totalCases,
      testCases,
    };
  }

  if (step === 'run') {
    const result = await runTests(agentId, {
      testCaseIds: Array.isArray(testCaseIds) && testCaseIds.length ? testCaseIds : undefined,
      trigger: 'manual',
    });
    return { step, ...result };
  }

  const versionId = await latestVersionId(agentId);
  if (!versionId) {
    throw Object.assign(new Error('No agent version found'), { status: 404 });
  }
  const result = await generateRecommendations(versionId, { force: true });
  return {
    step,
    versionId,
    blocked: !!result.blocked,
    accepted: result.accepted?.length || 0,
    rejected: result.rejected?.length || 0,
    recommendations: result.accepted || [],
    readiness: result.readiness,
  };
}

export default { runOptimizeStep, listOptimizeSteps, getOptimizeStatus };
