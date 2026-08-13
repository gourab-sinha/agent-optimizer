import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../../src/services/agentSyncService.js', () => ({
  syncAllAgents: vi.fn(),
}));
vi.mock('../../../src/services/callSyncService.js', () => ({
  syncAgentCalls: vi.fn(),
  getAgentCalls: vi.fn(),
}));
vi.mock('../../../src/services/rubricEvaluationService.js', () => ({
  generateRubricForAgentVersion: vi.fn(),
  evaluateCall: vi.fn(),
  getRubricByAgentVersion: vi.fn(),
}));
vi.mock('../../../src/services/patternDetectionService.js', () => ({
  detectPatterns: vi.fn(),
}));
vi.mock('../../../src/services/testGenerationService.js', () => ({
  generateTestCases: vi.fn(),
  getTestCases: vi.fn(),
}));
vi.mock('../../../src/services/testRunnerService.js', () => ({
  runTests: vi.fn(),
}));
vi.mock('../../../src/recommend/index.js', () => ({
  generateRecommendations: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { syncAgentCalls, getAgentCalls } from '../../../src/services/callSyncService.js';
import { generateRubricForAgentVersion, getRubricByAgentVersion } from '../../../src/services/rubricEvaluationService.js';
import { getTestCases } from '../../../src/services/testGenerationService.js';
import { runTests } from '../../../src/services/testRunnerService.js';
import { runOptimizeStep, getOptimizeStatus } from '../../../src/services/optimizePipelineService.js';

describe('optimizePipelineService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs tests with an allowed trigger', async () => {
    runTests.mockResolvedValueOnce({ success: true, totalPassed: 1, totalFailed: 0 });
    await runOptimizeStep({ agentId: 'a1', step: 'run', testCaseIds: ['t1'] });
    expect(runTests).toHaveBeenCalledWith('a1', {
      testCaseIds: ['t1'],
      trigger: 'manual',
    });
  });

  it('rejects an unknown step', async () => {
    await expect(runOptimizeStep({ agentId: 'a1', step: 'nope' })).rejects.toThrow(/Unknown optimize step/);
  });

  it('blocks when HighLevel has no calls', async () => {
    syncAgentCalls.mockResolvedValueOnce([]);
    const result = await runOptimizeStep({
      agentId: 'a1',
      locationId: 'loc-1',
      step: 'sync_calls',
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('no_calls');
  });

  it('builds a rubric from the latest agent version', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'ver-1' }] });
    generateRubricForAgentVersion.mockResolvedValueOnce({
      rubricId: 'rub-1',
      criteriaCount: 4,
      cached: false,
    });
    getRubricByAgentVersion.mockResolvedValueOnce({
      id: 'rub-1',
      criteria: [{ id: 'c1', key: 'greeting' }],
    });

    const result = await runOptimizeStep({ agentId: 'a1', step: 'rubric' });
    expect(result.rubricId).toBe('rub-1');
    expect(result.rubric.criteria).toHaveLength(1);
    expect(generateRubricForAgentVersion).toHaveBeenCalledWith('ver-1');
  });

  it('reports when a version has already been optimized', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'ver-1', label: 'baseline', source: 'snapshot', created_at: '2026-08-01' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'Price cave', description: 'Gives in', fail_count: 3, call_count: 5, impact_score: 1.2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'r1', rec_type: 'prompt_patch', tier: 'applicable', rationale: 'Tighten', payload: {}, status: 'proposed', created_at: '2026-08-14' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'run-1', status: 'completed', trigger: 'manual', created_at: '2026-08-14' }] });
    getAgentCalls.mockResolvedValueOnce([{ id: 'c1' }]);
    getTestCases.mockResolvedValueOnce([{ id: 't1', title: 'Book' }]);
    getRubricByAgentVersion.mockResolvedValueOnce({ id: 'rub-1', criteria: [] });

    const status = await getOptimizeStatus('a1');
    expect(status.optimized).toBe(true);
    expect(status.version.label).toBe('baseline');
    expect(status.recommendations).toHaveLength(1);
    expect(status.calls).toHaveLength(1);
    expect(status.testCases).toHaveLength(1);
  });

  it('returns stored calls when location is missing', async () => {
    getAgentCalls.mockResolvedValueOnce([{ id: 'c1' }]);
    const result = await runOptimizeStep({ agentId: 'a1', step: 'sync_calls' });
    expect(result.count).toBe(1);
    expect(result.blocked).toBe(false);
  });
});
