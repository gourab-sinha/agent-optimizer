import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/recommend/assembleInput.js', () => ({
  assembleInput: vi.fn(),
}));
vi.mock('../../../src/recommend/propose.js', () => ({
  proposeRecommendations: vi.fn(),
}));
vi.mock('../../../src/recommend/validate.js', () => ({
  validateAndInsert: vi.fn(),
}));
vi.mock('../../../src/recommend/rank.js', () => ({
  rankRecommendations: vi.fn((accepted) =>
    accepted.map((a) => ({ ...a, priorityScore: 1 }))
  ),
}));

import { generateRecommendations } from '../../../src/recommend/index.js';
import { assembleInput } from '../../../src/recommend/assembleInput.js';
import { proposeRecommendations } from '../../../src/recommend/propose.js';
import { validateAndInsert } from '../../../src/recommend/validate.js';
import { rankRecommendations } from '../../../src/recommend/rank.js';

describe('recommend/index generateRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks when readiness.canGenerate is false', async () => {
    assembleInput.mockResolvedValue({
      agent: { prompt: 'x' },
      patterns: [],
      priorRecommendations: [],
      readiness: {
        canGenerate: false,
        reasons: ['No issue patterns'],
        warnings: [],
        mode: 'patterns-only',
      },
    });

    const result = await generateRecommendations('av-1');
    expect(result.blocked).toBe(true);
    expect(result.accepted).toEqual([]);
    expect(proposeRecommendations).not.toHaveBeenCalled();
  });

  it('runs assemble → propose → validate → rank when ready', async () => {
    const input = {
      agent: { prompt: 'x' },
      patterns: [{ id: 'p1', impactScore: 0.8 }],
      priorRecommendations: [],
      readiness: {
        canGenerate: true,
        reasons: [],
        warnings: ['No tests'],
        mode: 'patterns-only',
      },
    };
    assembleInput.mockResolvedValue(input);
    proposeRecommendations.mockResolvedValue([{ recType: 'guardrail' }]);
    validateAndInsert.mockResolvedValue({
      accepted: [{ recType: 'guardrail', linkedPatternIds: ['p1'] }],
      rejected: [{ reason: 'x' }],
    });

    const result = await generateRecommendations('av-1');
    expect(assembleInput).toHaveBeenCalledWith('av-1', { patternLimit: 10 });
    expect(proposeRecommendations).toHaveBeenCalledWith(input, {
      singleShot: false,
    });
    expect(validateAndInsert).toHaveBeenCalledWith(
      [{ recType: 'guardrail' }],
      'av-1',
      input.agent,
      { patternsDetail: input.patterns }
    );
    expect(rankRecommendations).toHaveBeenCalled();
    expect(result.accepted[0].priorityScore).toBe(1);
    expect(result.blocked).toBe(false);
    expect(result.meta.proposalCount).toBe(1);
  });

  it('force bypasses readiness block', async () => {
    assembleInput.mockResolvedValue({
      agent: { prompt: 'x' },
      patterns: [],
      priorRecommendations: [],
      readiness: {
        canGenerate: false,
        reasons: ['No patterns'],
        warnings: [],
        mode: 'patterns-only',
      },
    });
    proposeRecommendations.mockResolvedValue([]);
    validateAndInsert.mockResolvedValue({ accepted: [], rejected: [] });

    const result = await generateRecommendations('av-1', { force: true });
    expect(result.blocked).toBe(false);
    expect(proposeRecommendations).toHaveBeenCalled();
  });
});
