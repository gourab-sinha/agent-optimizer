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

describe('recommend/validate', () => {
  const agentVersionId = 'av-1';
  const patternId = 'pat-1';
  const criterionId = 'crit-1';
  const testCaseId = 'tc-1';
  const actionId = 'act-1';

  const agentConfig = {
    prompt:
      'You are helpful. Always respect opt-out requests. TCPA compliance is required.',
    actions: [{ actionId, actionType: 'WEBHOOK', actionName: 'Hook' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM issue_patterns') || sql.includes('issue_patterns')) {
        return { rows: [{ id: patternId, criterion_id: criterionId }] };
      }
      if (sql.includes('rubric_criteria')) {
        return { rows: [{ id: criterionId }] };
      }
      if (sql.includes('test_cases')) {
        return { rows: [{ id: testCaseId }] };
      }
      if (sql.includes('FROM recommendations') && sql.includes('SELECT')) {
        return { rows: [] }; // existing fingerprints
      }
      if (sql.includes('INSERT INTO recommendations')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
  });

  function baseProposal(overrides = {}) {
    return {
      recType: 'welcome_message',
      payload: { newMessage: 'Hello there' },
      rationale: 'Improve greeting',
      linkedPatternIds: [patternId],
      expectedCriterionIds: [criterionId],
      supportingTestCaseIds: [testCaseId],
      ...overrides,
    };
  }

  it('accepts valid welcome_message and inserts', async () => {
    const { accepted, rejected } = await validateAndInsert(
      [baseProposal()],
      agentVersionId,
      agentConfig
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    expect(accepted[0].tier).toBe('applicable');
    expect(accepted[0].agent_version_id).toBe(agentVersionId);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recommendations'),
      expect.any(Array)
    );
  });

  it('rejects unknown recType', async () => {
    const { accepted, rejected } = await validateAndInsert(
      [baseProposal({ recType: 'not_a_type' })],
      agentVersionId,
      agentConfig
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/Unknown recType/);
  });

  it('rejects missing payload fields', async () => {
    const { rejected } = await validateAndInsert(
      [baseProposal({ payload: {} })],
      agentVersionId,
      agentConfig
    );
    expect(rejected[0].reason).toMatch(/Missing required field/);
  });

  it('rejects empty string payload fields', async () => {
    const { rejected } = await validateAndInsert(
      [baseProposal({ payload: { newMessage: '' } })],
      agentVersionId,
      agentConfig
    );
    expect(rejected[0].reason).toMatch(/non-empty string/);
  });

  it('validates bool, int ranges, float, enum, array, object', async () => {
    // idle_reminder: bool + int
    let result = await validateAndInsert(
      [
        baseProposal({
          recType: 'idle_reminder',
          payload: { enabled: true, afterSeconds: 10 },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'idle_reminder',
          payload: { enabled: 'yes', afterSeconds: 10 },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/boolean/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'max_call_duration',
          payload: { seconds: 50 },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/integer between/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'max_call_duration',
          payload: { seconds: 300 },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'advisory_temperature',
          payload: { value: 1.5 },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/float between/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'advisory_temperature',
          payload: { value: 0.5 },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'patience_level',
          payload: { value: 'extreme' },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/must be one of/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'patience_level',
          payload: { value: 'high' },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'action_add',
          payload: {
            actionType: 'INVALID',
            name: 'X',
            actionParameters: {},
          },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/must be one of/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'action_add',
          payload: {
            actionType: 'WEBHOOK',
            actionName: 'X', // alias should normalize to name
            actionParameters: {},
          },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'kb_attach',
          payload: { faqEntries: 'not-array' },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/array/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'action_update',
          payload: { actionId, changes: [] },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/object/);

    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'action_update',
          payload: { actionId, changes: { name: 'n' } },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);
  });

  it('rejects empty linkedPatternIds and unknown ids', async () => {
    let result = await validateAndInsert(
      [baseProposal({ linkedPatternIds: [] })],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/linkedPatternIds/);

    result = await validateAndInsert(
      [baseProposal({ linkedPatternIds: ['missing'] })],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/not found/);
  });

  it('auto-fills empty expectedCriterionIds from linked pattern; rejects unknown ids', async () => {
    let result = await validateAndInsert(
      [baseProposal({ expectedCriterionIds: [] })],
      agentVersionId,
      agentConfig
    );
    // Coherence repair: pull criterion from linked pattern
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].expectedCriterionIds).toContain(criterionId);

    result = await validateAndInsert(
      [baseProposal({ expectedCriterionIds: ['missing'] })],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/not found/);
  });

  it('defaults missing supportingTestCaseIds and rejects unknown ones', async () => {
    let result = await validateAndInsert(
      [baseProposal({ supportingTestCaseIds: undefined })],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);

    result = await validateAndInsert(
      [baseProposal({ supportingTestCaseIds: ['missing-tc'] })],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/supportingTestCaseId/);
  });

  it('validates prompt_patch rules', async () => {
    // empty newPrompt
    let result = await validateAndInsert(
      [
        baseProposal({
          recType: 'prompt_patch',
          payload: { newPrompt: '   ' },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/empty/);

    // too long
    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'prompt_patch',
          payload: { newPrompt: 'x'.repeat(agentConfig.prompt.length * 2 + 1) },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/too long/);

    // removes compliance language
    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'prompt_patch',
          payload: { newPrompt: 'Just be nice with no compliance text' },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/compliance|opt-out/i);

    // valid prompt keeps compliance
    result = await validateAndInsert(
      [
        baseProposal({
          recType: 'prompt_patch',
          payload: {
            newPrompt:
              'You are helpful. Always respect opt-out requests. TCPA compliance is required. Be friendlier.',
          },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].payload.diff).toBeTypeOf('string');
  });

  it('validates action_update actionId existence', async () => {
    const result = await validateAndInsert(
      [
        baseProposal({
          recType: 'action_update',
          payload: { actionId: 'missing-action', changes: { name: 'x' } },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/actionId/);
  });

  it('handles empty proposals list without insert', async () => {
    const result = await validateAndInsert([], agentVersionId, agentConfig);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(
      db.query.mock.calls.some((c) =>
        String(c[0]).includes('INSERT INTO recommendations')
      )
    ).toBe(false);
  });

  it('validates optional transferAction on escalation_rule', async () => {
    const result = await validateAndInsert(
      [
        baseProposal({
          recType: 'escalation_rule',
          payload: {
            trigger: 'angry',
            promptAddition: 'Escalate',
            // transferAction optional omitted
          },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);
  });

  it('accepts prompt_edit when find exists', async () => {
    const result = await validateAndInsert(
      [
        baseProposal({
          recType: 'prompt_edit',
          payload: {
            find: 'You are helpful',
            replace: 'You are extremely helpful',
          },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.accepted).toHaveLength(1);
  });

  it('rejects prompt_edit when find missing', async () => {
    const result = await validateAndInsert(
      [
        baseProposal({
          recType: 'prompt_edit',
          payload: { find: 'NOT_IN_PROMPT_XYZ', replace: 'x' },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/not found verbatim/);
  });

  it('rejects no-op action_update empty changes', async () => {
    const result = await validateAndInsert(
      [
        baseProposal({
          recType: 'action_update',
          payload: { actionId, changes: {} },
        }),
      ],
      agentVersionId,
      agentConfig
    );
    expect(result.rejected[0].reason).toMatch(/empty|no-op/i);
  });

  it('rejects duplicate fingerprints in batch', async () => {
    const p = baseProposal({
      recType: 'guardrail',
      payload: { promptAddition: 'Unique rule ABC' },
    });
    const result = await validateAndInsert([p, { ...p }], agentVersionId, agentConfig);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected.some((r) => /Duplicate/i.test(r.reason))).toBe(true);
  });
});
