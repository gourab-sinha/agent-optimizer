import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    close: vi.fn(),
    closePool: vi.fn(),
    pool: { on: vi.fn(), end: vi.fn() },
  },
}));

vi.mock('../../src/ghl/sdk-client.js', () => ({
  default: {
    oauth: {
      getAuthorizationUrl: vi.fn(() => 'https://example.com'),
      getAccessToken: vi.fn(),
    },
    voiceAi: vi.fn(() => ({})),
  },
}));

vi.mock('../../src/services/optimizePipelineService.js', () => ({
  listOptimizeSteps: vi.fn(() => ['sync_agent', 'sync_calls', 'rubric', 'evaluate', 'patterns', 'tests', 'run', 'recs']),
  runOptimizeStep: vi.fn(),
  getOptimizeStatus: vi.fn(),
}));

import { runOptimizeStep, getOptimizeStatus } from '../../src/services/optimizePipelineService.js';
import app from '../../src/index.js';

describe('Feature: optimize pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists pipeline steps', async () => {
    const res = await request(app).get('/api/optimize/steps');
    expect(res.status).toBe(200);
    expect(res.body.steps).toContain('sync_calls');
    expect(res.body.steps).toContain('recs');
  });

  it('runs a named step', async () => {
    runOptimizeStep.mockResolvedValueOnce({
      step: 'sync_calls',
      count: 3,
      blocked: false,
    });

    const res = await request(app).post('/api/optimize/step').send({
      agentId: 'agt-1',
      locationId: 'loc-1',
      step: 'sync_calls',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);
    expect(runOptimizeStep).toHaveBeenCalledWith({
      agentId: 'agt-1',
      locationId: 'loc-1',
      companyId: undefined,
      step: 'sync_calls',
      testCaseIds: undefined,
    });
  });

  it('returns version status for an agent', async () => {
    getOptimizeStatus.mockResolvedValueOnce({
      version: { id: 'ver-1', label: 'baseline' },
      optimized: true,
      lastOptimizedAt: '2026-08-14T00:00:00.000Z',
      patterns: [],
      recommendations: [],
    });

    const res = await request(app).get('/api/optimize/status/agt-1');
    expect(res.status).toBe(200);
    expect(res.body.optimized).toBe(true);
    expect(res.body.version.label).toBe('baseline');
  });

  it('returns 400 when the service rejects a missing agent', async () => {
    const error = Object.assign(new Error('agentId is required'), { status: 400 });
    runOptimizeStep.mockRejectedValueOnce(error);

    const res = await request(app).post('/api/optimize/step').send({ step: 'sync_calls' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/agentId/i);
  });
});
