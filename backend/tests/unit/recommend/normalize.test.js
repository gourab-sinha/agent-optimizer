import { describe, it, expect } from 'vitest';
import {
  normalizeProposal,
  normalizeProposals,
  proposalFingerprint,
} from '../../../src/recommend/normalize.js';

describe('recommend/normalize', () => {
  it('maps snake_case and actionName alias for action_add', () => {
    const n = normalizeProposal({
      rec_type: 'action_add',
      payload: {
        actionType: 'WEBHOOK',
        actionName: 'Hook',
        parameters: { url: 'x' },
      },
      linked_pattern_ids: ['p1'],
      expected_criterion_ids: ['c1'],
      confidence: 0.9,
    });
    expect(n.recType).toBe('action_add');
    expect(n.payload.name).toBe('Hook');
    expect(n.payload.actionParameters).toEqual({ url: 'x' });
    expect(n.linkedPatternIds).toEqual(['p1']);
    expect(n.confidence).toBe(0.9);
  });

  it('maps action_update top-level fields into changes', () => {
    const n = normalizeProposal({
      recType: 'action_update',
      payload: {
        actionId: 'a1',
        instructions: 'Do X',
      },
    });
    expect(n.payload.changes.instructions).toBe('Do X');
  });

  it('maps prompt_edit search/replacement', () => {
    const n = normalizeProposal({
      recType: 'prompt_edit',
      payload: { search: 'old', replacement: 'new' },
    });
    expect(n.payload.find).toBe('old');
    expect(n.payload.replace).toBe('new');
  });

  it('normalizeProposals and fingerprint', () => {
    const list = normalizeProposals([
      { recType: 'guardrail', payload: { promptAddition: 'x' } },
    ]);
    expect(list).toHaveLength(1);
    const fp = proposalFingerprint(list[0]);
    expect(fp).toContain('guardrail');
  });
});
