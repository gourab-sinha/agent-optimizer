import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/rubricEvaluationService.js', () => ({
  generateRubricForAgentVersion: vi.fn(),
  evaluateCall: vi.fn(),
  getRubricByAgentVersion: vi.fn(),
}));

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

import {
  generateRubric,
  getRubric,
  evaluateCalls,
  getFindings,
} from '../../../src/controllers/analysisController.js';
import {
  generateRubricForAgentVersion,
  evaluateCall,
  getRubricByAgentVersion,
} from '../../../src/services/rubricEvaluationService.js';
import db from '../../../src/db/connection.js';
import { createMockReq, createMockRes } from '../../helpers/mocks.js';

describe('controllers/analysisController', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('generateRubric', () => {
    it('400 when agentVersionId missing', async () => {
      const res = createMockRes();
      await generateRubric(createMockReq({ body: {} }), res);
      expect(res.statusCode).toBe(400);
    });

    it('200 on success', async () => {
      generateRubricForAgentVersion.mockResolvedValue({
        rubricId: 'r1',
        criteriaCount: 8,
        cached: false,
      });
      const res = createMockRes();
      await generateRubric(
        createMockReq({ body: { agentVersionId: 'av' } }),
        res
      );
      expect(res.body.success).toBe(true);
      expect(res.body.rubricId).toBe('r1');
    });

    it('500 on error', async () => {
      generateRubricForAgentVersion.mockRejectedValue(new Error('boom'));
      const res = createMockRes();
      await generateRubric(
        createMockReq({ body: { agentVersionId: 'av' } }),
        res
      );
      expect(res.statusCode).toBe(500);
    });
  });

  describe('getRubric', () => {
    it('400 when param missing', async () => {
      const res = createMockRes();
      await getRubric(createMockReq({ params: {} }), res);
      expect(res.statusCode).toBe(400);
    });

    it('404 when not found', async () => {
      getRubricByAgentVersion.mockResolvedValue(null);
      const res = createMockRes();
      await getRubric(createMockReq({ params: { agentVersionId: 'av' } }), res);
      expect(res.statusCode).toBe(404);
    });

    it('200 when found', async () => {
      getRubricByAgentVersion.mockResolvedValue({ id: 'r1' });
      const res = createMockRes();
      await getRubric(createMockReq({ params: { agentVersionId: 'av' } }), res);
      expect(res.body.rubric.id).toBe('r1');
    });

    it('500 on error', async () => {
      getRubricByAgentVersion.mockRejectedValue(new Error('x'));
      const res = createMockRes();
      await getRubric(createMockReq({ params: { agentVersionId: 'av' } }), res);
      expect(res.statusCode).toBe(500);
    });
  });

  describe('evaluateCalls', () => {
    it('validates body', async () => {
      const res = createMockRes();
      await evaluateCalls(createMockReq({ body: {} }), res);
      expect(res.statusCode).toBe(400);

      await evaluateCalls(
        createMockReq({ body: { rubricId: 'r', callIds: [] } }),
        res
      );
      expect(res.statusCode).toBe(400);
    });

    it('evaluates each call collecting success and errors', async () => {
      evaluateCall
        .mockResolvedValueOnce({ findingsCreated: 3 })
        .mockRejectedValueOnce(new Error('fail call'));
      const res = createMockRes();
      await evaluateCalls(
        createMockReq({ body: { rubricId: 'r', callIds: ['c1', 'c2'] } }),
        res
      );
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0].success).toBe(true);
      expect(res.body.results[1].success).toBe(false);
    });

    it('500 when response json fails (outer catch)', async () => {
      evaluateCall.mockResolvedValue({ findingsCreated: 1 });
      const res = createMockRes();
      let calls = 0;
      res.json = vi.fn(function json(payload) {
        calls += 1;
        if (calls === 1) {
          throw new Error('json fail');
        }
        this.body = payload;
        return this;
      });
      await evaluateCalls(
        createMockReq({ body: { rubricId: 'r', callIds: ['c1'] } }),
        res
      );
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('json fail');
    });
  });

  describe('getFindings', () => {
    it('400 without callId', async () => {
      const res = createMockRes();
      await getFindings(createMockReq({ params: {} }), res);
      expect(res.statusCode).toBe(400);
    });

    it('returns findings with filters', async () => {
      db.query.mockResolvedValue({ rows: [{ id: 'f1' }] });
      const res = createMockRes();
      await getFindings(
        createMockReq({
          params: { callId: 'c1' },
          query: { rubricId: 'r1', status: 'fail' },
        }),
        res
      );
      expect(res.body.findings).toHaveLength(1);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM findings'),
        expect.arrayContaining(['c1', 'r1', 'fail'])
      );
    });

    it('500 on db error', async () => {
      db.query.mockRejectedValue(new Error('db'));
      const res = createMockRes();
      await getFindings(createMockReq({ params: { callId: 'c1' } }), res);
      expect(res.statusCode).toBe(500);
    });
  });
});
