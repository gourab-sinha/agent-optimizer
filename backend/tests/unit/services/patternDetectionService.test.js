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
  detectPatterns,
  getPatternsForAgentVersion,
  getPatternsForAgent,
  getPatternDetails,
} from '../../../src/services/patternDetectionService.js';

describe('services/patternDetectionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when rubric not found', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(detectPatterns('r1')).rejects.toThrow('Rubric r1 not found');
  });

  it('detects patterns, updates existing, skips low impact', async () => {
    callLLM.mockResolvedValue({
      content: JSON.stringify({
        title: 'Weak greeting',
        description: 'Agent fails to greet',
      }),
    });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM rubrics r')) {
        return {
          rows: [{ id: 'r1', agent_version_id: 'av1', agent_id: 'a1' }],
        };
      }
      if (sql.includes('GROUP BY f.criterion_id')) {
        return {
          rows: [
            {
              criterion_id: 'c1',
              criterion_key: 'greet',
              criterion_description: 'Greet',
              severity: 3,
              check_type: 'llm',
              call_count: 10,
              fail_count: 8,
              avg_confidence: 0.9,
              failing_finding_ids: ['f1'],
            },
            {
              criterion_id: 'c2',
              criterion_key: 'minor',
              criterion_description: 'Minor',
              severity: 1,
              check_type: 'llm',
              call_count: 100,
              fail_count: 3,
              avg_confidence: 0.1,
              failing_finding_ids: ['f2'],
            },
          ],
        };
      }
      if (sql.includes('FROM findings') && sql.includes('ORDER BY created_at')) {
        return {
          rows: [{ id: 'f1', rationale: 'no hi', confidence: 0.9 }],
        };
      }
      if (sql.includes('FROM issue_patterns') && sql.includes('WHERE rubric_id')) {
        return { rows: [{ id: 'pat-existing' }] };
      }
      if (sql.includes('UPDATE issue_patterns')) {
        return { rows: [{ id: 'pat-existing' }] };
      }
      return { rows: [] };
    });

    const result = await detectPatterns('r1', {
      minFailCount: 3,
      minImpactScore: 0.3,
    });
    expect(result.success).toBe(true);
    expect(result.patterns.length).toBeGreaterThanOrEqual(1);
    expect(result.skippedLowImpact).toContain('minor');
  });

  it('creates new pattern when none exists and uses LLM fallback', async () => {
    callLLM.mockResolvedValue({ content: 'not-json' });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM rubrics r')) {
        return {
          rows: [{ id: 'r1', agent_version_id: 'av1', agent_id: 'a1' }],
        };
      }
      if (sql.includes('GROUP BY f.criterion_id')) {
        return {
          rows: [
            {
              criterion_id: 'c1',
              criterion_key: 'greet',
              criterion_description: 'Greet',
              severity: 3,
              check_type: 'llm',
              call_count: 5,
              fail_count: 5,
              avg_confidence: null,
              failing_finding_ids: ['f1'],
            },
          ],
        };
      }
      if (sql.includes('FROM findings') && sql.includes('LIMIT 5')) {
        return { rows: [{ id: 'f1', rationale: 'x', confidence: 1 }] };
      }
      if (sql.includes('FROM issue_patterns') && sql.includes('WHERE rubric_id')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO issue_patterns')) {
        return { rows: [{ id: 'pat-new' }] };
      }
      return { rows: [] };
    });

    const result = await detectPatterns('r1');
    expect(result.patterns[0].id).toBe('pat-new');
    expect(result.patterns[0].title).toMatch(/greet/);
  });

  it('getPatternsForAgentVersion / getPatternsForAgent / getPatternDetails', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'p1' }] });
    expect(await getPatternsForAgentVersion('av')).toEqual([{ id: 'p1' }]);

    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'av1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
    expect(await getPatternsForAgent('a1')).toEqual([]);
    expect(await getPatternsForAgent('a1')).toEqual([{ id: 'p1' }]);

    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getPatternDetails('x')).rejects.toThrow('not found');

    db.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'p1',
            representative_finding_ids: ['f1'],
            criterion_key: 'k',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'f1', rationale: 'r' }],
      });
    const details = await getPatternDetails('p1');
    expect(details.sampleFindings).toHaveLength(1);
  });
});
