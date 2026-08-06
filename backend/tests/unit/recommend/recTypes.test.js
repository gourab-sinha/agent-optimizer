import { describe, it, expect } from 'vitest';
import {
  REC_TYPES,
  GHL_ACTION_TYPES,
  getRecTypeKeys,
  isValidRecType,
  getTier,
  getPayloadShape,
  applyRecommendation,
} from '../../../src/recommend/recTypes.js';

describe('recommend/recTypes', () => {
  describe('registry helpers', () => {
    it('lists all rec type keys', () => {
      const keys = getRecTypeKeys();
      expect(keys).toContain('prompt_patch');
      expect(keys).toContain('advisory_temperature');
      expect(keys.length).toBe(Object.keys(REC_TYPES).length);
    });

    it('isValidRecType', () => {
      expect(isValidRecType('prompt_patch')).toBe(true);
      expect(isValidRecType('nope')).toBe(false);
    });

    it('getTier returns applicable or advisory', () => {
      expect(getTier('prompt_patch')).toBe('applicable');
      expect(getTier('advisory_model')).toBe('advisory');
      expect(() => getTier('invalid')).toThrow('Unknown rec_type');
    });

    it('getPayloadShape returns shape', () => {
      expect(getPayloadShape('prompt_patch')).toEqual({ newPrompt: 'string' });
      expect(() => getPayloadShape('invalid')).toThrow('Unknown rec_type');
    });

    it('exposes GHL action types', () => {
      expect(GHL_ACTION_TYPES).toContain('CALL_TRANSFER');
      expect(GHL_ACTION_TYPES).toContain('KNOWLEDGE_BASE');
    });
  });

  describe('applyRecommendation', () => {
    const baseConfig = {
      agentPrompt: 'Base prompt',
      welcomeMessage: 'Hi',
      patienceLevel: 'medium',
      maxCallDuration: 600,
      sendUserIdleReminders: false,
      reminderAfterIdleTimeSeconds: 5,
    };
    const baseActions = [
      { actionId: 'a1', actionType: 'WEBHOOK', name: 'Hook' },
    ];

    it('throws for unknown type', () => {
      expect(() => applyRecommendation('nope', baseConfig, baseActions, {})).toThrow(
        'cannot apply'
      );
    });

    it('applies prompt_patch', () => {
      const r = applyRecommendation('prompt_patch', baseConfig, baseActions, {
        newPrompt: 'New',
      });
      expect(r.config.agentPrompt).toBe('New');
      expect(r.actions).toBe(baseActions);
    });

    it('applies welcome_message', () => {
      const r = applyRecommendation('welcome_message', baseConfig, baseActions, {
        newMessage: 'Welcome!',
      });
      expect(r.config.welcomeMessage).toBe('Welcome!');
    });

    it('applies patience_level', () => {
      const r = applyRecommendation('patience_level', baseConfig, baseActions, {
        value: 'high',
      });
      expect(r.config.patienceLevel).toBe('high');
    });

    it('applies max_call_duration', () => {
      const r = applyRecommendation('max_call_duration', baseConfig, baseActions, {
        seconds: 300,
      });
      expect(r.config.maxCallDuration).toBe(300);
    });

    it('applies idle_reminder', () => {
      const r = applyRecommendation('idle_reminder', baseConfig, baseActions, {
        enabled: true,
        afterSeconds: 10,
      });
      expect(r.config.sendUserIdleReminders).toBe(true);
      expect(r.config.reminderAfterIdleTimeSeconds).toBe(10);
    });

    it('applies action_add', () => {
      const r = applyRecommendation('action_add', baseConfig, baseActions, {
        actionType: 'WORKFLOW_TRIGGER',
        name: 'Trigger',
        actionParameters: { x: 1 },
      });
      expect(r.actions).toHaveLength(2);
      expect(r.actions[1].pendingCreate).toBe(true);
    });

    it('applies action_update', () => {
      const r = applyRecommendation('action_update', baseConfig, baseActions, {
        actionId: 'a1',
        changes: { name: 'Updated' },
      });
      expect(r.actions[0].name).toBe('Updated');
      expect(r.actions[0].pendingUpdate).toBe(true);
    });

    it('applies kb_attach creating new KB action', () => {
      const r = applyRecommendation('kb_attach', baseConfig, baseActions, {
        faqEntries: [{ q: 'Q', a: 'A' }],
      });
      const kb = r.actions.find((a) => a.actionType === 'KNOWLEDGE_BASE');
      expect(kb).toBeDefined();
      expect(kb.pendingCreate).toBe(true);
      expect(kb.actionParameters.faqEntries).toHaveLength(1);
    });

    it('applies kb_attach merging into existing KB action', () => {
      const actions = [
        {
          actionType: 'KNOWLEDGE_BASE',
          actionParameters: { faqEntries: [{ q: 'old', a: 'old' }] },
        },
      ];
      const r = applyRecommendation('kb_attach', baseConfig, actions, {
        faqEntries: [{ q: 'new', a: 'new' }],
      });
      expect(r.actions[0].actionParameters.faqEntries).toHaveLength(2);
      expect(r.actions[0].pendingUpdate).toBe(true);
    });

    it('applies escalation_rule without transfer', () => {
      const r = applyRecommendation('escalation_rule', baseConfig, baseActions, {
        trigger: 'angry',
        promptAddition: 'Escalate politely',
      });
      expect(r.config.agentPrompt).toContain('Escalate politely');
      expect(r.actions).toHaveLength(1);
    });

    it('applies escalation_rule with transferAction', () => {
      const r = applyRecommendation('escalation_rule', baseConfig, baseActions, {
        trigger: 'angry',
        promptAddition: 'Escalate',
        transferAction: { name: 'Transfer to human' },
      });
      expect(r.actions).toHaveLength(2);
      expect(r.actions[1].actionType).toBe('CALL_TRANSFER');
      expect(r.actions[1].pendingCreate).toBe(true);
    });

    it('applies guardrail', () => {
      const r = applyRecommendation('guardrail', baseConfig, baseActions, {
        promptAddition: 'Never discuss competitors',
      });
      expect(r.config.agentPrompt).toContain('Never discuss competitors');
    });

    it('applies advisory_temperature with simOverrides', () => {
      const r = applyRecommendation('advisory_temperature', baseConfig, baseActions, {
        value: 0.2,
      });
      expect(r.simOverrides).toEqual({ temperature: 0.2 });
    });

    it('applies advisory_model with simOverrides', () => {
      const r = applyRecommendation('advisory_model', baseConfig, baseActions, {
        suggestion: 'claude-3',
      });
      expect(r.simOverrides).toEqual({ model: 'claude-3' });
    });
  });
});
