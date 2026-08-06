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

  it('assembles full context with patterns, tests, criteria', async () => {
    db.query.mockImplementation(async (sql, params) => {
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
                model: 'gpt-4o',
                temperature: 0.7,
                voiceId: 'voice-123',
                language: 'en-US',
                endCallFunctionEnabled: true,
                knowledgeBase: { id: 'kb-123' },
                transferNumbers: ['+1234567890'],
              },
              actions: [
                {
                  id: 'act-1',
                  actionType: 'WEBHOOK',
                  name: 'Hook',
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
              criterion_key: 'greet',
              representative_finding_ids: ['f1', 'f2'],
            },
          ],
        };
      }
      if (sql.includes('FROM findings')) {
        return {
          rows: [{ evidence_turn_ids: ['t1', 't2'] }],
        };
      }
      if (sql.includes('FROM call_turns')) {
        return {
          rows: [{ text: 'A'.repeat(300) }],
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
          rows: [{ id: 'c1', key: 'greet' }],
        };
      }
      return { rows: [] };
    });

    const result = await assembleInput('av-1');
    expect(result.agent.agentId).toBe('agent-1');
    expect(result.agent.actions[0].actionId).toBe('act-1');

    // Verify new agent config fields are extracted
    expect(result.agent.model).toBe('gpt-4o');
    expect(result.agent.temperature).toBe(0.7);
    expect(result.agent.voiceId).toBe('voice-123');
    expect(result.agent.language).toBe('en-US');
    expect(result.agent.endCallFunctionEnabled).toBe(true);
    expect(result.agent.knowledgeBase).toEqual({ id: 'kb-123' });
    expect(result.agent.transferNumbers).toEqual(['+1234567890']);

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].evidence[0]).toMatch(/\.\.\.$/);
    expect(result.testResults.cases[0].flaky).toBe(true);
    expect(result.testResults.cases[0].failedCriteria[0].key).toBe('greet');
    expect(result.constraints.criterionIds.greet).toBe('c1');
    expect(result.constraints.recTypes.length).toBeGreaterThan(0);
  });

  it('handles patterns with no evidence and no test runs', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agent_versions')) {
        return {
          rows: [
            {
              id: 'av-1',
              agent_id: 'a',
              config: {},
              actions: [{ actionId: 'x', actionType: 'WEBHOOK', actionName: 'n' }],
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
              call_count: 2,
              impact_score: 0.1,
              criterion_key: 'k',
              representative_finding_ids: [],
            },
          ],
        };
      }
      if (sql.includes('FROM test_runs')) {
        return { rows: [] };
      }
      if (sql.includes('FROM rubric_criteria')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await assembleInput('av-1');
    expect(result.patterns[0].evidence).toEqual([]);
    expect(result.testResults).toBeNull();
    expect(result.agent.prompt).toBe('');
    expect(result.agent.patienceLevel).toBe('medium');
  });

  it('handles findings with empty turn ids', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM agent_versions')) {
        return {
          rows: [{ id: 'av', agent_id: 'a', config: { agentPrompt: 'p' }, actions: [] }],
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
              criterion_key: 'k',
              representative_finding_ids: ['f1'],
            },
          ],
        };
      }
      if (sql.includes('FROM findings')) {
        return { rows: [{ evidence_turn_ids: [] }] };
      }
      if (sql.includes('FROM test_runs')) return { rows: [] };
      if (sql.includes('FROM rubric_criteria')) return { rows: [] };
      return { rows: [] };
    });

    const result = await assembleInput('av');
    expect(result.patterns[0].evidence).toEqual([]);
  });
});
