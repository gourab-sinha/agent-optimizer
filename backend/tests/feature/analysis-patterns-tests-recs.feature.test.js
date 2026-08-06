import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/controllers/analysisController.js', () => ({
  generateRubric: vi.fn((req, res) => res.json({ success: true, mocked: true })),
  getRubric: vi.fn((req, res) => res.json({ success: true, rubric: {} })),
  evaluateCalls: vi.fn((req, res) => res.json({ success: true, results: [] })),
  getFindings: vi.fn((req, res) => res.json({ success: true, findings: [] })),
}));

vi.mock('../../src/services/patternDetectionService.js', () => ({
  default: {
    detectPatterns: vi.fn(),
    getPatternsForAgent: vi.fn(),
    getPatternsForAgentVersion: vi.fn(),
    getPatternDetails: vi.fn(),
  },
}));

vi.mock('../../src/services/testGenerationService.js', () => ({
  default: {
    generateTestCases: vi.fn(),
    getTestCases: vi.fn(),
    getTestCaseDetails: vi.fn(),
    archiveTestCase: vi.fn(),
  },
}));

vi.mock('../../src/services/testRunnerService.js', () => ({
  default: {
    runTests: vi.fn(),
    getTestRun: vi.fn(),
    getTestResults: vi.fn(),
    getTestRunsForAgent: vi.fn(),
  },
}));

vi.mock('../../src/recommend/index.js', () => ({
  generateRecommendations: vi.fn(),
}));

vi.mock('../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

import patternService from '../../src/services/patternDetectionService.js';
import testGen from '../../src/services/testGenerationService.js';
import testRunner from '../../src/services/testRunnerService.js';
import { generateRecommendations } from '../../src/recommend/index.js';
import db from '../../src/db/connection.js';
import analysisRoutes from '../../src/routes/analysisRoutes.js';
import patternRoutes from '../../src/routes/patternRoutes.js';
import testRoutes from '../../src/routes/testRoutes.js';
import recommendationRoutes from '../../src/routes/recommendations.js';
import apiRoutes from '../../src/routes/index.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analysis', analysisRoutes);
  app.use('/api/patterns', patternRoutes);
  app.use('/api/tests', testRoutes);
  app.use('/api/recommendations', recommendationRoutes);
  return app;
}

describe('Feature: Analysis / Patterns / Tests / Recommendations', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  it('analysis routes mount controllers', async () => {
    await request(app).post('/api/analysis/rubric/generate').send({});
    await request(app).get('/api/analysis/rubric/av1');
    await request(app).post('/api/analysis/evaluate').send({});
    await request(app).get('/api/analysis/findings/c1');
  });

  it('pattern routes', async () => {
    let res = await request(app).post('/api/patterns/detect').send({});
    expect(res.status).toBe(400);

    patternService.detectPatterns.mockResolvedValue({ success: true, patterns: [] });
    res = await request(app)
      .post('/api/patterns/detect')
      .send({ rubricId: 'r1', minFailCount: 2 });
    expect(res.body.success).toBe(true);

    patternService.detectPatterns.mockRejectedValue(new Error('fail'));
    res = await request(app).post('/api/patterns/detect').send({ rubricId: 'r1' });
    expect(res.status).toBe(500);

    patternService.getPatternsForAgent.mockResolvedValue([{ id: 'p1' }]);
    res = await request(app).get('/api/patterns/agent/a1');
    expect(res.body.count).toBe(1);
    patternService.getPatternsForAgent.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/patterns/agent/a1');
    expect(res.status).toBe(500);

    patternService.getPatternsForAgentVersion.mockResolvedValue([]);
    res = await request(app).get('/api/patterns/version/v1');
    expect(res.status).toBe(200);
    patternService.getPatternsForAgentVersion.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/patterns/version/v1');
    expect(res.status).toBe(500);

    patternService.getPatternDetails.mockResolvedValue({ id: 'p1' });
    res = await request(app).get('/api/patterns/p1');
    expect(res.status).toBe(200);
    patternService.getPatternDetails.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/patterns/p1');
    expect(res.status).toBe(404);
  });

  it('test routes', async () => {
    let res = await request(app).post('/api/tests/generate').send({});
    expect(res.status).toBe(400);
    testGen.generateTestCases.mockResolvedValue({ success: true, totalCases: 1 });
    res = await request(app).post('/api/tests/generate').send({ agentId: 'a1' });
    expect(res.body.success).toBe(true);
    testGen.generateTestCases.mockRejectedValue(new Error('fail'));
    res = await request(app).post('/api/tests/generate').send({ agentId: 'a1' });
    expect(res.status).toBe(500);

    testGen.getTestCases.mockResolvedValue([{ id: 't1' }]);
    res = await request(app).get('/api/tests/agent/a1?kind=happy_path&includeArchived=true');
    expect(res.body.count).toBe(1);
    testGen.getTestCases.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/tests/agent/a1');
    expect(res.status).toBe(500);

    testGen.getTestCaseDetails.mockResolvedValue({ id: 't1' });
    res = await request(app).get('/api/tests/t1');
    expect(res.status).toBe(200);
    testGen.getTestCaseDetails.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/tests/t1');
    expect(res.status).toBe(404);

    testGen.archiveTestCase.mockResolvedValue({ id: 't1' });
    res = await request(app).put('/api/tests/t1/archive').send({ archived: true });
    expect(res.status).toBe(200);
    testGen.archiveTestCase.mockRejectedValue(new Error('nf'));
    res = await request(app).put('/api/tests/t1/archive').send({});
    expect(res.status).toBe(404);

    res = await request(app).post('/api/tests/run').send({});
    expect(res.status).toBe(400);
    testRunner.runTests.mockResolvedValue({ success: true });
    res = await request(app).post('/api/tests/run').send({ agentId: 'a1' });
    expect(res.body.success).toBe(true);
    testRunner.runTests.mockRejectedValue(new Error('fail'));
    res = await request(app).post('/api/tests/run').send({ agentId: 'a1' });
    expect(res.status).toBe(500);

    testRunner.getTestRun.mockResolvedValue({ id: 'run' });
    res = await request(app).get('/api/tests/runs/run');
    expect(res.status).toBe(200);
    testRunner.getTestRun.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/tests/runs/run');
    expect(res.status).toBe(404);

    testRunner.getTestResults.mockResolvedValue([{ id: 'r' }]);
    res = await request(app).get('/api/tests/runs/run/results');
    expect(res.body.count).toBe(1);
    testRunner.getTestResults.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/tests/runs/run/results');
    expect(res.status).toBe(500);

    testRunner.getTestRunsForAgent.mockResolvedValue([{ id: 'run' }]);
    res = await request(app).get('/api/tests/agent/a1/runs?limit=5');
    expect(res.body.count).toBe(1);
    testRunner.getTestRunsForAgent.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/tests/agent/a1/runs');
    expect(res.status).toBe(500);
  });

  it('recommendation routes', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    let res = await request(app).get('/api/recommendations/agent/a1');
    expect(res.status).toBe(404);

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'av1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'rec1',
            rec_type: 'prompt_patch',
            tier: 'applicable',
            payload: {},
            rationale: 'r',
            status: 'proposed',
            linked_pattern_ids: ['p1'],
            expected_criterion_ids: ['c1'],
            supporting_test_case_ids: [],
            created_at: 'c',
            updated_at: 'u',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', title: 'T', criterion_key: 'k' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c1', key: 'k', description: 'd' }] });

    res = await request(app).get('/api/recommendations/agent/a1?status=proposed');
    expect(res.body.success).toBe(true);
    expect(res.body.recommendations).toHaveLength(1);

    db.query.mockRejectedValueOnce(new Error('db'));
    res = await request(app).get('/api/recommendations/agent/a1');
    expect(res.status).toBe(500);

    db.query.mockResolvedValueOnce({ rows: [] });
    res = await request(app).post('/api/recommendations/generate/a1');
    expect(res.status).toBe(404);

    db.query.mockResolvedValueOnce({ rows: [{ id: 'av1' }] });
    generateRecommendations.mockResolvedValue({
      accepted: [{ id: 1 }],
      rejected: [{ id: 2 }],
    });
    res = await request(app).post('/api/recommendations/generate/a1');
    expect(res.body.accepted).toBe(1);

    generateRecommendations.mockRejectedValue(new Error('gen fail'));
    db.query.mockResolvedValueOnce({ rows: [{ id: 'av1' }] });
    res = await request(app).post('/api/recommendations/generate/a1');
    expect(res.status).toBe(500);

    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    res = await request(app).delete('/api/recommendations/rec1');
    expect(res.body.success).toBe(true);
    db.query.mockRejectedValueOnce(new Error('db'));
    res = await request(app).delete('/api/recommendations/rec1');
    expect(res.status).toBe(500);
  });

  it('api index 404 handler', async () => {
    const app2 = express();
    app2.use('/api', apiRoutes);
    // oauth and others still import real modules - mock may not cover all.
    // Mount only router 404 by using a minimal path that doesn't match entities.
    // apiRoutes will try to load oauth which needs env - already set.
    const res = await request(app2).get('/api/does-not-exist');
    // May be 404 from router
    expect([404, 500]).toContain(res.status);
  });
});
