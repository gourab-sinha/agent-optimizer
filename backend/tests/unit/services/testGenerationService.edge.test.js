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
import { generateTestCases } from '../../../src/services/testGenerationService.js';

describe('testGenerationService edge case failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when edge case LLM JSON is invalid', async () => {
    callLLM
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Happy',
          persona: { name: 'A' },
          scenario: 's',
          expected_flow: 'f',
          criterion_keys: [],
        }),
      })
      .mockResolvedValueOnce({ content: 'not-json' });

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
      if (sql.includes('FROM rubric_criteria')) {
        return { rows: [{ id: 'c1', key: 'greet', description: 'd', severity: 1, category: 'flow' }] };
      }
      if (sql.includes('FROM calls')) return { rows: [] };
      if (sql.includes('FROM issue_patterns')) {
        return {
          rows: [
            {
              id: 'p1',
              title: 'P',
              description: 'D',
              criterion_id: 'c1',
              criterion_key: 'greet',
              criterion_description: 'cd',
              impact_score: 1,
              call_count: 1,
            },
          ],
        };
      }
      if (sql.includes('FROM findings')) return { rows: [] };
      if (sql.includes('INSERT INTO test_cases')) return { rows: [{ id: 'tc1' }] };
      return { rows: [] };
    });

    await expect(
      generateTestCases('a1', { happyPathCount: 1, edgeCaseCount: 1 })
    ).rejects.toThrow('Failed to generate edge case');
  });
});
