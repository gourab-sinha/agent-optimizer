import { describe, it, expect } from 'vitest';
import {
  REC_TYPES,
  GHL_ACTION_TYPES,
  getRecTypeKeys,
  isValidRecType,
  getTier,
  getPayloadShape,
  applyRecommendation,
  buildRecTypeCatalog,
  getPreferenceRank,
  getDefaultRisk,
} from '../../../src/recommend/recTypes.js';

describe('recommend/recTypes', () => {
  describe('registry helpers', () => {
    it('lists all rec type keys including prompt_edit', () => {
      const keys = getRecTypeKeys();
      expect(keys).toContain('prompt_patch');
      expect(keys).toContain('prompt_edit');
      expect(keys).toContain('advisory_temperature');
      expect(keys.length).toBe(Object.keys(REC_TYPES).length);
    });

    it('isValidRecType / getTier / getPayloadShape', () => {
      expect(isValidRecType('prompt_patch')).toBe(true);
      expect(isValidRecType('nope')).toBe(false);
      expect(getTier('prompt_patch')).toBe('applicable');
      expect(getTier('advisory_model')).toBe('advisory');
      expect(() => getTier('invalid')).toThrow('Unknown rec_type');
      expect(getPayloadShape('prompt_edit')).toEqual({
        find: 'string',
        replace: 'string',
      });
      expect(() => getPayloadShape('invalid')).toThrow('Unknown rec_type');
    });

    it('buildRecTypeCatalog includes guidance', () => {
      const catalog = buildRecTypeCatalog();
      expect(catalog).toContain('action_update');
      expect(catalog).toContain('prompt_edit');
      expect(catalog).toContain('when:');
    });

    it('preference and risk helpers', () => {
      expect(getPreferenceRank('action_update')).toBeLessThan(
        getPreferenceRank('prompt_patch')
      );
      expect(getDefaultRisk('prompt_patch')).toBe('high');
      expect(getDefaultRisk('guardrail')).toBe('low');
      expect(GHL_ACTION_TYPES).toContain('CALL_TRANSFER');
    });
  });

  describe('applyRecommendation', () => {
    const baseConfig = {
      agentPrompt: 'Base prompt with Hello section.',
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
      expect(() =>
        applyRecommendation('nope', baseConfig, baseActions, {})
      ).toThrow('cannot apply');
    });

    it('applies prompt_edit', () => {
      const r = applyRecommendation('prompt_edit', baseConfig, baseActions, {
        find: 'Hello',
        replace: 'Hi there',
      });
      expect(r.config.agentPrompt).toContain('Hi there');
      expect(r.config.agentPrompt).not.toContain('Hello');
    });

    it('applies prompt_patch', () => {
      const r = applyRecommendation('prompt_patch', baseConfig, baseActions, {
        newPrompt: 'New',
      });
      expect(r.config.agentPrompt).toBe('New');
    });

    it('applies welcome_message / patience / duration / idle', () => {
      expect(
        applyRecommendation('welcome_message', baseConfig, baseActions, {
          newMessage: 'Welcome!',
        }).config.welcomeMessage
      ).toBe('Welcome!');
      expect(
        applyRecommendation('patience_level', baseConfig, baseActions, {
          value: 'high',
        }).config.patienceLevel
      ).toBe('high');
      expect(
        applyRecommendation('max_call_duration', baseConfig, baseActions, {
          seconds: 300,
        }).config.maxCallDuration
      ).toBe(300);
      const idle = applyRecommendation('idle_reminder', baseConfig, baseActions, {
        enabled: true,
        afterSeconds: 10,
      });
      expect(idle.config.sendUserIdleReminders).toBe(true);
    });

    it('applies action_add with name and instructions', () => {
      const r = applyRecommendation('action_add', baseConfig, baseActions, {
        actionType: 'WORKFLOW_TRIGGER',
        name: 'Trigger',
        instructions: 'When user confirms',
        actionParameters: { x: 1 },
      });
      expect(r.actions).toHaveLength(2);
      expect(r.actions[1].pendingCreate).toBe(true);
      expect(r.actions[1].name).toBe('Trigger');
      expect(r.actions[1].instructions).toBe('When user confirms');
    });

    it('applies action_update', () => {
      const r = applyRecommendation('action_update', baseConfig, baseActions, {
        actionId: 'a1',
        changes: { name: 'Updated' },
      });
      expect(r.actions[0].name).toBe('Updated');
      expect(r.actions[0].pendingUpdate).toBe(true);
    });

    it('applies kb_attach create and merge', () => {
      const created = applyRecommendation('kb_attach', baseConfig, baseActions, {
        faqEntries: [{ q: 'Q', a: 'A' }],
      });
      expect(
        created.actions.find((a) => a.actionType === 'KNOWLEDGE_BASE')
      ).toBeDefined();

      const merged = applyRecommendation(
        'kb_attach',
        baseConfig,
        [
          {
            actionType: 'KNOWLEDGE_BASE',
            actionParameters: { faqEntries: [{ q: 'old', a: 'old' }] },
          },
        ],
        { faqEntries: [{ q: 'new', a: 'new' }] }
      );
      expect(merged.actions[0].actionParameters.faqEntries).toHaveLength(2);
    });

    it('applies escalation and guardrail', () => {
      const esc = applyRecommendation('escalation_rule', baseConfig, baseActions, {
        trigger: 'angry',
        promptAddition: 'Escalate',
        transferAction: { name: 'Human' },
      });
      expect(esc.config.agentPrompt).toContain('Escalate');
      expect(esc.actions).toHaveLength(2);

      const g = applyRecommendation('guardrail', baseConfig, baseActions, {
        promptAddition: 'Never discuss competitors',
      });
      expect(g.config.agentPrompt).toContain('Never discuss competitors');
    });

    it('applies advisories', () => {
      expect(
        applyRecommendation('advisory_temperature', baseConfig, baseActions, {
          value: 0.2,
        }).simOverrides
      ).toEqual({ temperature: 0.2 });
      expect(
        applyRecommendation('advisory_model', baseConfig, baseActions, {
          suggestion: 'claude-3',
        }).simOverrides
      ).toEqual({ model: 'claude-3' });
    });
  });
});
