import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/llmService.js', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '../../../src/services/llmService.js';
import { proposeRecommendations } from '../../../src/recommend/propose.js';

describe('recommend/propose', () => {
  const input = {
    agent: {
      prompt: 'Be helpful',
      welcomeMessage: 'Hi',
      patienceLevel: 'medium',
      maxCallDuration: 600,
      actions: [
        {
          actionId: 'a1',
          actionType: 'APPOINTMENT_BOOKING',
          actionName: 'Book',
        },
      ],
    },
    patterns: [
      {
        id: 'p1',
        title: 'Missed booking',
        description: 'Fails to book',
        criterionKey: 'books_appt',
        failCount: 5,
        callCount: 10,
        impactScore: 0.8,
        evidence: ['Agent never confirmed time'],
      },
    ],
    testResults: {
      runId: 'run-1',
      runsPerCase: 2,
      cases: [
        {
          id: 'tc1',
          title: 'Book flow',
          passRate: 0.5,
          flaky: true,
          seededByPatternId: 'p1',
          failedCriteria: [
            {
              key: 'books_appt',
              criterionId: 'c1',
              exampleRationale: 'No booking action',
            },
          ],
        },
      ],
    },
    constraints: {
      recTypes: ['action_update', 'prompt_patch'],
      actionTypes: ['APPOINTMENT_BOOKING'],
      criterionIds: { books_appt: 'c1' },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON array proposals', async () => {
    callLLM.mockResolvedValue({
      content: JSON.stringify([
        {
          recType: 'action_update',
          payload: { actionId: 'a1', changes: {} },
          rationale: 'fix',
          linkedPatternIds: ['p1'],
          expectedCriterionIds: ['c1'],
          supportingTestCaseIds: [],
        },
      ]),
      usage: { completionTokens: 100 },
    });

    const proposals = await proposeRecommendations(input);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].recType).toBe('action_update');
    expect(callLLM).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'recommend', temperature: 0.3 })
    );
  });

  it('strips markdown fences and unwraps recommendations key', async () => {
    callLLM.mockResolvedValue({
      content:
        '```json\n{"recommendations":[{"recType":"prompt_patch","payload":{"newPrompt":"x"}}]}\n```',
      usage: { completionTokens: 50 },
    });
    const proposals = await proposeRecommendations(input);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].recType).toBe('prompt_patch');
  });

  it('wraps single object into array', async () => {
    callLLM.mockResolvedValue({
      content: JSON.stringify({
        recType: 'guardrail',
        payload: { promptAddition: 'x' },
      }),
      usage: { completionTokens: 20 },
    });
    const proposals = await proposeRecommendations(input);
    expect(Array.isArray(proposals)).toBe(true);
    expect(proposals).toHaveLength(1);
  });

  it('handles null testResults and empty actions', async () => {
    callLLM.mockResolvedValue({
      content: '[]',
      usage: { completionTokens: 1 },
    });
    const sparse = {
      ...input,
      agent: { ...input.agent, actions: [] },
      testResults: null,
      patterns: [
        {
          ...input.patterns[0],
          evidence: [],
        },
      ],
    };
    const proposals = await proposeRecommendations(sparse);
    expect(proposals).toEqual([]);
  });

  it('handles all-passing test results text path', async () => {
    callLLM.mockResolvedValue({
      content: '[]',
      usage: { completionTokens: 1 },
    });
    await proposeRecommendations({
      ...input,
      testResults: {
        runId: 'r',
        runsPerCase: 1,
        cases: [{ id: 't', title: 'ok', passRate: 1, flaky: false, failedCriteria: [] }],
      },
    });
    expect(callLLM).toHaveBeenCalled();
  });

  it('throws on invalid JSON', async () => {
    callLLM.mockResolvedValue({
      content: 'not-json',
      usage: { completionTokens: 1 },
    });
    await expect(proposeRecommendations(input)).rejects.toThrow(
      'LLM returned invalid JSON'
    );
  });
});
