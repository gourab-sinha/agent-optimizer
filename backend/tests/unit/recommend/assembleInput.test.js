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

import db from '../../../src/db/connection.js';
import { assembleInput } from '../../../src/recommend/assembleInput.js';

describe('recommend/assembleInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when agent version not found', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(assembleInput('missing')).rejects.toThrow(
      'Agent version missing not found'
    );
  });

  it('assembles rich context with readiness OK', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agent_versions')) {
        return {
          rows: [
            {
              id: 'av-1',
              agent_id: 'agent-1',
              config: {
                agentPrompt: 'Prompt',
                welcomeMessage: 'Hi',
                patienceLevel: 'low',
                maxCallDuration: 300,
                model: 'gpt',
                temperature: 0.2,
              },
              actions: [
                {
                  id: 'act-1',
                  actionType: 'WEBHOOK',
                  name: 'Hook',
                  instructions: 'When done',
                  actionParameters: { url: 'x' },
                },
              ],
            },
          ],
        };
      }
      if (sql.includes('FROM issue_patterns')) {
        return {
          rows: [
            {
              id: 'p1',
              title: 'T',
              description: 'D',
              fail_count: 3,
              call_count: 5,
              impact_score: 0.9,
              criterion_id: 'c1',
              criterion_key: 'greet',
              criterion_severity: 2,
              criterion_category: 'flow',
              representative_finding_ids: ['f1', 'f2'],
            },
          ],
        };
      }
      if (sql.includes('FROM findings')) {
        return {
          rows: [
            {
              id: 'f1',
              rationale: 'no greeting',
              confidence: 0.9,
              evidence_turn_ids: ['t1'],
              status: 'fail',
            },
          ],
        };
      }
      if (sql.includes('FROM call_turns')) {
        return {
          rows: [{ text: 'A'.repeat(300), speaker: 'agent' }],
        };
      }
      if (sql.includes('FROM test_runs')) {
        return {
          rows: [{ id: 'run-1', runs_per_case: 2 }],
        };
      }
      if (sql.includes('FROM test_results')) {
        return {
          rows: [
            {
              test_case_id: 'tc1',
              title: 'Case 1',
              seeded_by_pattern_id: 'p1',
              passed: true,
              criterion_outcomes: {},
            },
            {
              test_case_id: 'tc1',
              title: 'Case 1',
              seeded_by_pattern_id: 'p1',
              passed: false,
              criterion_outcomes: {
                c1: { status: 'fail', key: 'greet', rationale: 'no hi' },
              },
            },
          ],
        };
      }
      if (sql.includes('FROM rubric_criteria')) {
        return {
          rows: [
            {
              id: 'c1',
              key: 'greet',
              severity: 2,
              category: 'flow',
              description: 'Greets',
            },
          ],
        };
      }
      if (sql.includes('FROM recommendations')) {
        return {
          rows: [
            {
              id: 'r1',
              rec_type: 'guardrail',
              rationale: 'old',
              status: 'proposed',
              payload: {},
              linked_pattern_ids: ['p1'],
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await assembleInput('av-1');
    expect(result.agent.agentId).toBe('agent-1');
    expect(result.agent.actions[0].actionId).toBe('act-1');
    expect(result.agent.actions[0].instructions).toBe('When done');
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].rationales[0]).toMatch(/no greeting/);
    expect(result.patterns[0].evidence[0]).toMatch(/AGENT:/);
    expect(result.testResults.cases[0].flaky).toBe(true);
    expect(result.testResults.summary.failing).toBe(1);
    expect(result.priorRecommendations).toHaveLength(1);
    expect(result.readiness.canGenerate).toBe(true);
    expect(result.constraints.recTypeCatalog).toContain('action_update');
  });

  it('readiness blocked without patterns', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agent_versions')) {
        return {
          rows: [
            {
              id: 'av-1',
              agent_id: 'a',
              config: { agentPrompt: 'p' },
              actions: [],
            },
          ],
        };
      }
      if (sql.includes('FROM issue_patterns')) return { rows: [] };
      if (sql.includes('FROM test_runs')) return { rows: [] };
      if (sql.includes('FROM rubric_criteria')) {
        return {
          rows: [
            {
              id: 'c1',
              key: 'k',
              severity: 1,
              category: 'flow',
              description: 'd',
            },
          ],
        };
      }
      if (sql.includes('FROM recommendations')) return { rows: [] };
      return { rows: [] };
    });

    const result = await assembleInput('av-1');
    expect(result.readiness.canGenerate).toBe(false);
    expect(result.readiness.reasons.join(' ')).toMatch(/patterns/i);
    expect(result.testResults).toBeNull();
  });

  it('handles patterns with empty evidence ids', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agent_versions')) {
        return {
          rows: [
            {
              id: 'av',
              agent_id: 'a',
              config: { agentPrompt: 'p' },
              actions: [],
            },
          ],
        };
      }
      if (sql.includes('FROM issue_patterns')) {
        return {
          rows: [
            {
              id: 'p1',
              title: 'T',
              description: 'D',
              fail_count: 1,
              call_count: 1,
              impact_score: 1,
              criterion_id: 'c1',
              criterion_key: 'k',
              criterion_severity: 1,
              criterion_category: 'flow',
              representative_finding_ids: [],
            },
          ],
        };
      }
      if (sql.includes('FROM test_runs')) return { rows: [] };
      if (sql.includes('FROM rubric_criteria')) {
        return {
          rows: [
            {
              id: 'c1',
              key: 'k',
              severity: 1,
              category: 'flow',
              description: 'd',
            },
          ],
        };
      }
      if (sql.includes('FROM recommendations')) return { rows: [] };
      return { rows: [] };
    });

    const result = await assembleInput('av');
    expect(result.patterns[0].evidence).toEqual([]);
    expect(result.patterns[0].rationales).toEqual([]);
    expect(result.readiness.canGenerate).toBe(true);
  });
});
