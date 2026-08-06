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

import { generateRecommendations } from '../../../src/recommend/index.js';
import { assembleInput } from '../../../src/recommend/assembleInput.js';
import { proposeRecommendations } from '../../../src/recommend/propose.js';
import { validateAndInsert } from '../../../src/recommend/validate.js';

describe('recommend/index generateRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs assemble -> propose -> validate pipeline', async () => {
    const input = { agent: { prompt: 'x' }, patterns: [] };
    assembleInput.mockResolvedValue(input);
    proposeRecommendations.mockResolvedValue([{ recType: 'guardrail' }]);
    validateAndInsert.mockResolvedValue({
      accepted: [{ id: 1 }],
      rejected: [{ reason: 'x' }],
    });

    const result = await generateRecommendations('av-1');
    expect(assembleInput).toHaveBeenCalledWith('av-1');
    expect(proposeRecommendations).toHaveBeenCalledWith(input);
    expect(validateAndInsert).toHaveBeenCalledWith(
      [{ recType: 'guardrail' }],
      'av-1',
      input.agent
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });
});
