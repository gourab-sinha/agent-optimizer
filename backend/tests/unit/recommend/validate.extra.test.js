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
import { validateAndInsert } from '../../../src/recommend/validate.js';

describe('recommend/validate extra branches', () => {
  const agentVersionId = 'av-1';
  const patternId = 'pat-1';
  const criterionId = 'crit-1';

  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('issue_patterns')) return { rows: [{ id: patternId }] };
      if (sql.includes('rubric_criteria')) return { rows: [{ id: criterionId }] };
      if (sql.includes('test_cases')) return { rows: [] };
      if (sql.includes('INSERT INTO recommendations')) return { rows: [] };
      return { rows: [] };
    });
  });

  function base(overrides = {}) {
    return {
      recType: 'guardrail',
      payload: { promptAddition: 'Be careful' },
      rationale: 'r',
      linkedPatternIds: [patternId],
      expectedCriterionIds: [criterionId],
      supportingTestCaseIds: [],
      ...overrides,
    };
  }

  it('accepts advisory_model string payload', async () => {
    const result = await validateAndInsert(
      [
        base({
          recType: 'advisory_model',
          payload: { suggestion: 'gpt-4o' },
        }),
      ],
      agentVersionId,
      { prompt: 'p', actions: [] }
    );
    expect(result.accepted[0].tier).toBe('advisory');
  });

  it('accepts escalation with transferAction object', async () => {
    const result = await validateAndInsert(
      [
        base({
          recType: 'escalation_rule',
          payload: {
            trigger: 'angry',
            promptAddition: 'Escalate',
            transferAction: { name: 'Human' },
          },
        }),
      ],
      agentVersionId,
      { prompt: 'p', actions: [] }
    );
    expect(result.accepted).toHaveLength(1);
  });

  it('rejects non-object transferAction when provided', async () => {
    const result = await validateAndInsert(
      [
        base({
          recType: 'escalation_rule',
          payload: {
            trigger: 'angry',
            promptAddition: 'Escalate',
            transferAction: 'not-object',
          },
        }),
      ],
      agentVersionId,
      { prompt: 'p', actions: [] }
    );
    expect(result.rejected[0].reason).toMatch(/object/);
  });
});
