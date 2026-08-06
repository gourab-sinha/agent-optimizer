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
  generateTestCases,
  getTestCases,
  getTestCaseDetails,
  archiveTestCase,
} from '../../../src/services/testGenerationService.js';

describe('services/testGenerationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when agent not found', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(generateTestCases('a1')).rejects.toThrow('not found');
  });

  it('throws when agent has no prompt', async () => {
    db.query.mockResolvedValue({
      rows: [{ id: 'a1', name: 'A', config: {}, version_id: 'v1', version_config: {} }],
    });
    await expect(generateTestCases('a1')).rejects.toThrow('no prompt');
  });

  it('throws when no rubric', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'a1',
            name: 'A',
            config: { agentPrompt: 'P'.repeat(50) },
            version_id: 'v1',
            version_config: {},
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(generateTestCases('a1')).rejects.toThrow('No rubric');
  });

  it('generates happy path and edge cases', async () => {
    const happy = {
      title: 'Happy',
      persona: { name: 'Ann', age: 30 },
      scenario: 'Books',
      expected_flow: 'steps',
      criterion_keys: ['greet'],
    };
    const edge = {
      title: 'Edge',
      persona: { name: 'Bob', challenge: 'impatient' },
      scenario: 'Hard',
      expected_behavior: 'handle',
      criterion_keys: ['greet'],
    };

    callLLM
      .mockResolvedValueOnce({ content: JSON.stringify(happy) })
      .mockResolvedValueOnce({ content: JSON.stringify(edge) });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agents a')) {
        return {
          rows: [
            {
              id: 'a1',
              name: 'A',
              config: { agentPrompt: 'Prompt text here' },
              version_id: 'v1',
              version_config: {},
            },
          ],
        };
      }
      if (sql.includes('FROM rubrics')) {
        return { rows: [{ id: 'r1' }] };
      }
      if (sql.includes('FROM rubric_criteria')) {
        return {
          rows: [{ id: 'c1', key: 'greet', description: 'd', severity: 2, category: 'flow' }],
        };
      }
      if (sql.includes('FROM calls c')) {
        return { rows: [{ id: 'call1', summary: 'sum' }] };
      }
      if (sql.includes('FROM issue_patterns')) {
        return {
          rows: [
            {
              id: 'p1',
              title: 'Pat',
              description: 'D',
              criterion_id: 'c1',
              criterion_key: 'greet',
              criterion_description: 'cd',
              impact_score: 0.8,
              call_count: 5,
            },
          ],
        };
      }
      if (sql.includes('FROM findings f')) {
        return {
          rows: [
            {
              id: 'f1',
              call_id: 'call1',
              status: 'fail',
              rationale: 'r',
              confidence: 0.9,
              criterion_key: 'greet',
              criterion_description: 'cd',
              call_summary: 'sum',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO test_cases')) {
        return { rows: [{ id: 'tc-new' }] };
      }
      return { rows: [] };
    });

    const result = await generateTestCases('a1', {
      happyPathCount: 1,
      edgeCaseCount: 1,
    });
    expect(result.success).toBe(true);
    expect(result.happyPathCases).toHaveLength(1);
    expect(result.edgeCases).toHaveLength(1);
    expect(result.totalCases).toBe(2);
  });

  it('throws when happy path LLM JSON invalid', async () => {
    callLLM.mockResolvedValue({ content: 'bad' });
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agents a')) {
        return {
          rows: [
            {
              id: 'a1',
              name: 'A',
              config: { agentPrompt: 'Prompt' },
              version_id: 'v1',
              version_config: {},
            },
          ],
        };
      }
      if (sql.includes('FROM rubrics')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('FROM rubric_criteria')) return { rows: [] };
      if (sql.includes('FROM calls')) return { rows: [] };
      if (sql.includes('FROM issue_patterns')) return { rows: [] };
      if (sql.includes('FROM findings')) return { rows: [] };
      return { rows: [] };
    });
    await expect(
      generateTestCases('a1', { happyPathCount: 1, edgeCaseCount: 0 })
    ).rejects.toThrow('Failed to generate happy path case');
  });

  it('getTestCases / getTestCaseDetails / archiveTestCase', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'tc1' }] });
    expect(await getTestCases('a1')).toEqual([{ id: 'tc1' }]);
    await getTestCases('a1', { kind: 'happy_path', includeArchived: true });

    db.query.mockResolvedValue({ rows: [] });
    await expect(getTestCaseDetails('x')).rejects.toThrow('not found');
    db.query.mockResolvedValue({ rows: [{ id: 'tc1' }] });
    expect(await getTestCaseDetails('tc1')).toEqual({ id: 'tc1' });

    db.query.mockResolvedValue({ rows: [] });
    await expect(archiveTestCase('x')).rejects.toThrow('not found');
    db.query.mockResolvedValue({ rows: [{ id: 'tc1' }] });
    expect(await archiveTestCase('tc1', true)).toEqual({ id: 'tc1' });
  });
});
