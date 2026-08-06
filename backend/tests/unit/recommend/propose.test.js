import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/llmService.js', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '../../../src/services/llmService.js';
import { proposeRecommendations } from '../../../src/recommend/propose.js';

describe('recommend/propose', () => {
  const input = {
    agent: {
      prompt: 'Be helpful. Always respect opt-out requests.',
      welcomeMessage: 'Hi',
      patienceLevel: 'medium',
      maxCallDuration: 600,
      model: 'gpt',
      temperature: 0.5,
      voiceId: 'v',
      language: 'en',
      endCallFunctionEnabled: false,
      enableVoicemailDetection: false,
      waitForGreeting: false,
      knowledgeBase: null,
      transferNumbers: [],
      actions: [
        {
          actionId: 'a1',
          actionType: 'APPOINTMENT_BOOKING',
          actionName: 'Book',
          instructions: 'When ready',
          actionParameters: {},
        },
      ],
    },
    patterns: [
      {
        id: 'p1',
        title: 'Missed booking',
        description: 'Fails to book',
        criterionId: 'c1',
        criterionKey: 'books_appt',
        criterionSeverity: 3,
        criterionCategory: 'tools',
        failCount: 5,
        callCount: 10,
        impactScore: 0.8,
        rationales: ['Never confirmed time'],
        evidence: ['Agent: ok bye'],
      },
    ],
    testResults: {
      runId: 'run-1',
      runsPerCase: 2,
      summary: { total: 1, failing: 1, passing: 0, overallPassRate: 0.5 },
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
    priorRecommendations: [],
    constraints: {
      recTypes: ['action_update', 'prompt_patch', 'guardrail'],
      actionTypes: ['APPOINTMENT_BOOKING'],
      criterionIds: { books_appt: 'c1' },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('two-phase diagnose then expand', async () => {
    callLLM
      .mockResolvedValueOnce({
        content: JSON.stringify({
          strategies: [
            {
              patternId: 'p1',
              recType: 'action_update',
              rootCause: 'Weak tool trigger',
              confidence: 0.85,
              risk: 'medium',
              primaryCriterionId: 'c1',
            },
          ],
        }),
        usage: { completionTokens: 50 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          recommendations: [
            {
              recType: 'action_update',
              payload: {
                actionId: 'a1',
                changes: { instructions: 'Book when confirmed' },
              },
              rationale: 'Fix booking',
              linkedPatternIds: ['p1'],
              expectedCriterionIds: ['c1'],
              supportingTestCaseIds: [],
              confidence: 0.85,
              risk: 'medium',
            },
          ],
        }),
        usage: { completionTokens: 100 },
      });

    const proposals = await proposeRecommendations(input);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].recType).toBe('action_update');
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('falls back to single-shot when diagnose empty', async () => {
    callLLM
      .mockResolvedValueOnce({
        content: JSON.stringify({ strategies: [] }),
        usage: { completionTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          recommendations: [
            {
              recType: 'guardrail',
              payload: { promptAddition: 'Always confirm' },
              rationale: 'x',
              linkedPatternIds: ['p1'],
              expectedCriterionIds: ['c1'],
            },
          ],
        }),
        usage: { completionTokens: 20 },
      });

    const proposals = await proposeRecommendations(input);
    expect(proposals[0].recType).toBe('guardrail');
  });

  it('singleShot option skips diagnose', async () => {
    callLLM.mockResolvedValue({
      content:
        '```json\n{"recommendations":[{"recType":"prompt_edit","payload":{"find":"Be helpful","replace":"Be very helpful"},"linkedPatternIds":["p1"],"expectedCriterionIds":["c1"]}]}\n```',
      usage: { completionTokens: 30 },
    });
    const proposals = await proposeRecommendations(input, { singleShot: true });
    expect(proposals[0].recType).toBe('prompt_edit');
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('retries once on invalid JSON then succeeds', async () => {
    callLLM
      .mockResolvedValueOnce({ content: 'not-json', usage: { completionTokens: 1 } })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          strategies: [
            {
              patternId: 'p1',
              recType: 'guardrail',
              confidence: 0.7,
              primaryCriterionId: 'c1',
            },
          ],
        }),
        usage: { completionTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          recommendations: [
            {
              recType: 'guardrail',
              payload: { promptAddition: 'X' },
              linkedPatternIds: ['p1'],
              expectedCriterionIds: ['c1'],
            },
          ],
        }),
        usage: { completionTokens: 10 },
      });

    const proposals = await proposeRecommendations(input);
    expect(proposals).toHaveLength(1);
  });

  it('handles null testResults and empty actions in singleShot', async () => {
    callLLM.mockResolvedValue({
      content: '[]',
      usage: { completionTokens: 1 },
    });
    const sparse = {
      ...input,
      agent: { ...input.agent, actions: [] },
      testResults: null,
      patterns: [{ ...input.patterns[0], evidence: [], rationales: [] }],
    };
    const proposals = await proposeRecommendations(sparse, { singleShot: true });
    expect(proposals).toEqual([]);
  });
});
