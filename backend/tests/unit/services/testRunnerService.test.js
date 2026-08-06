import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

vi.mock('../../../src/services/llmService.js', () => ({
  callLLM: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { callLLM } from '../../../src/services/llmService.js';
import {
  runTests,
  getTestRun,
  getTestResults,
  getTestRunsForAgent,
} from '../../../src/services/testRunnerService.js';

describe('services/testRunnerService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when agent not found', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(runTests('a1')).rejects.toThrow('not found');
  });

  it('throws when no prompt', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 'a1',
          name: 'A',
          location_id: 'l',
          config: {},
          version_id: 'v1',
          version_config: {},
        },
      ],
    });
    await expect(runTests('a1')).rejects.toThrow('no prompt');
  });

  it('throws when no rubric', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            name: 'A',
            location_id: 'l',
            config: { agentPrompt: 'P' },
            version_id: 'v1',
            version_config: {},
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(runTests('a1')).rejects.toThrow('No rubric');
  });

  it('throws when no test cases', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            name: 'A',
            location_id: 'l',
            config: { agentPrompt: 'P' },
            version_id: 'v1',
            version_config: {},
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'c1', key: 'k', description: 'd', severity: 1, category: 'flow', check_type: 'llm' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(runTests('a1')).rejects.toThrow('No test cases');
  });

  it('runs tests successfully with pass and fail', async () => {
    callLLM
      // simulate conversation
      .mockResolvedValueOnce({
        content: JSON.stringify({
          conversation: [
            { speaker: 'agent', text: 'Hello' },
            { speaker: 'caller', text: 'Hi' },
          ],
        }),
      })
      // evaluate criterion
      .mockResolvedValueOnce({
        content: JSON.stringify({
          status: 'pass',
          confidence: 0.9,
          rationale: 'ok',
          evidence: 'Hello',
        }),
      })
      // second attempt conversation invalid -> fallback
      .mockResolvedValueOnce({ content: 'not-json' })
      // evaluate after fallback
      .mockResolvedValueOnce({
        content: JSON.stringify({
          status: 'fail',
          confidence: 0.5,
          rationale: 'bad',
          evidence: '',
        }),
      });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agents a')) {
        return {
          rows: [
            {
              id: 'a1',
              name: 'A',
              location_id: 'l',
              config: { agentPrompt: 'Be helpful' },
              version_id: 'v1',
              version_config: {},
            },
          ],
        };
      }
      if (sql.includes('FROM rubrics')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('FROM rubric_criteria')) {
        return {
          rows: [
            {
              id: 'crit-1',
              key: 'greet',
              description: 'Greet',
              severity: 2,
              category: 'flow',
              check_type: 'llm',
            },
          ],
        };
      }
      if (sql.includes('FROM test_cases')) {
        return {
          rows: [
            {
              id: 'tc1',
              kind: 'happy_path',
              title: 'Greet test',
              persona: JSON.stringify({ name: 'Ann', needs: 'help' }),
              scenario: 'Caller wants help',
              criterion_ids: ['crit-1'],
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO test_runs')) {
        return { rows: [{ id: 'run-1' }] };
      }
      if (sql.includes('INSERT INTO test_results')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE test_runs')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const result = await runTests('a1', {
      runsPerCase: 2,
      trigger: 'manual',
      testCaseIds: ['tc1'],
    });
    expect(result.success).toBe(true);
    expect(result.totalTests).toBe(2);
    expect(result.testRunId).toBe('run-1');
  });

  it('stores failed result when runSingleTest throws', async () => {
    callLLM.mockRejectedValue(new Error('llm down'));

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agents a')) {
        return {
          rows: [
            {
              id: 'a1',
              name: 'A',
              location_id: 'l',
              config: { agentPrompt: 'P' },
              version_id: 'v1',
              version_config: {},
            },
          ],
        };
      }
      if (sql.includes('FROM rubrics')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('FROM rubric_criteria')) {
        return { rows: [{ id: 'c1', key: 'k', description: 'd', severity: 1, category: 'flow', check_type: 'llm' }] };
      }
      if (sql.includes('FROM test_cases')) {
        return {
          rows: [
            {
              id: 'tc1',
              kind: 'edge_case',
              title: 'T',
              persona: { name: 'X' },
              scenario: 'S',
              criterion_ids: ['c1'],
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO test_runs')) return { rows: [{ id: 'run' }] };
      return { rows: [] };
    });

    const result = await runTests('a1');
    expect(result.totalTests).toBe(1);
    expect(result.totalPassed).toBe(0);
  });

  it('getTestRun / getTestResults / getTestRunsForAgent', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(getTestRun('x')).rejects.toThrow('not found');

    db.query.mockResolvedValue({ rows: [{ id: 'run' }] });
    expect(await getTestRun('run')).toEqual({ id: 'run' });

    db.query.mockResolvedValue({ rows: [{ id: 'res' }] });
    expect(await getTestResults('run')).toHaveLength(1);

    db.query.mockResolvedValue({ rows: [{ id: 'run' }] });
    expect(await getTestRunsForAgent('a1', { limit: 5 })).toHaveLength(1);
  });
});
