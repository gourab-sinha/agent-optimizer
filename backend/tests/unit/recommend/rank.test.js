import { describe, it, expect } from 'vitest';
import {
  rankRecommendations,
  scoreRecommendation,
} from '../../../src/recommend/rank.js';

describe('recommend/rank', () => {
  const patterns = [
    { id: 'p1', impactScore: 0.9 },
    { id: 'p2', impactScore: 0.2 },
  ];

  it('scores higher impact + confidence higher', () => {
    const high = scoreRecommendation(
      {
        recType: 'action_update',
        linkedPatternIds: ['p1'],
        confidence: 0.9,
        risk: 'low',
      },
      patterns
    );
    const low = scoreRecommendation(
      {
        recType: 'prompt_patch',
        linkedPatternIds: ['p2'],
        confidence: 0.4,
        risk: 'high',
      },
      patterns
    );
    expect(high.priorityScore).toBeGreaterThan(low.priorityScore);
  });

  it('ranks list descending', () => {
    const ranked = rankRecommendations(
      [
        {
          recType: 'prompt_patch',
          linkedPatternIds: ['p2'],
          confidence: 0.5,
          risk: 'high',
        },
        {
          recType: 'action_update',
          linkedPatternIds: ['p1'],
          confidence: 0.9,
          risk: 'low',
        },
      ],
      patterns
    );
    expect(ranked[0].recType).toBe('action_update');
    expect(ranked[0].priorityScore).toBeDefined();
  });
});
