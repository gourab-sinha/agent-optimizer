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
import { runTests } from '../../../src/services/testRunnerService.js';

describe('testRunnerService evaluation parse failure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('treats unparseable evaluation as fail', async () => {
    callLLM
      .mockResolvedValueOnce({
        content: JSON.stringify({
          conversation: [
            { speaker: 'agent', text: 'Hi' },
            { speaker: 'caller', text: 'Hello' },
          ],
        }),
      })
      .mockResolvedValueOnce({ content: 'not-json-eval' });

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
        return {
          rows: [
            {
              id: 'c1',
              key: 'k',
              description: 'd',
              severity: 1,
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
              title: 'T',
              persona: { name: 'N' },
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
    expect(result.results[0].criterionOutcomes.c1.status).toBe('fail');
  });

  it('falls back when conversation turns empty array', async () => {
    callLLM
      .mockResolvedValueOnce({
        content: JSON.stringify({ conversation: [] }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          status: 'pass',
          confidence: 1,
          rationale: 'ok',
          evidence: 'x',
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
              config: { agentPrompt: 'P' },
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
              id: 'c1',
              key: 'k',
              description: 'd',
              severity: 1,
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
              title: 'T',
              persona: { name: 'N' },
              scenario: 'Scenario text here',
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
  });

  it('handles conversation array response format', async () => {
    callLLM
      .mockResolvedValueOnce({
        content: JSON.stringify([
          { speaker: 'agent', text: 'Hi' },
          { speaker: 'caller', text: 'Yo' },
        ]),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          status: 'pass',
          confidence: 1,
          rationale: 'ok',
          evidence: 'Hi',
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
              config: { agentPrompt: 'P' },
              version_id: 'v1',
              version_config: { agentPrompt: 'fallback' },
            },
          ],
        };
      }
      if (sql.includes('FROM rubrics')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('FROM rubric_criteria')) {
        return {
          rows: [
            {
              id: 'c1',
              key: 'k',
              description: 'd',
              severity: 1,
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
              title: 'T',
              persona: '{"name":"N"}',
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
    expect(result.totalPassed).toBe(1);
  });
});
