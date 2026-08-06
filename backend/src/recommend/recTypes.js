/**
 * Recommendation Types - Single Source of Truth
 *
 * Defines valid recommendation types, tiers, payload schemas, apply functions,
 * and guidance used by the proposal prompts.
 *
 * Tier is ALWAYS taken from this table — never from the LLM.
 */

/**
 * Merge FAQ entries into an existing or new KNOWLEDGE_BASE action
 */
function upsertKbAction(actions, faqEntries) {
  const kbActionIndex = actions.findIndex((a) => a.actionType === 'KNOWLEDGE_BASE');

  if (kbActionIndex >= 0) {
    const existingKb = actions[kbActionIndex];
    const existingEntries = existingKb.actionParameters?.faqEntries || [];

    return actions.map((action, idx) =>
      idx === kbActionIndex
        ? {
            ...action,
            actionParameters: {
              ...action.actionParameters,
              faqEntries: [...existingEntries, ...faqEntries],
            },
            pendingUpdate: true,
          }
        : action
    );
  }

  return [
    ...actions,
    {
      pendingCreate: true,
      actionType: 'KNOWLEDGE_BASE',
      name: 'Knowledge Base',
      actionParameters: { faqEntries },
    },
  ];
}

/**
 * Apply a single exact substring replacement on the agent prompt
 */
function applyPromptEdit(config, find, replace) {
  const current = config.agentPrompt || '';
  const idx = current.indexOf(find);
  if (idx === -1) {
    return { config, actions: null, error: 'find string not present in prompt' };
  }
  const newPrompt =
    current.slice(0, idx) + replace + current.slice(idx + find.length);
  return {
    config: { ...config, agentPrompt: newPrompt },
    actions: null,
  };
}

/**
 * REC_TYPES whitelist
 */
export const REC_TYPES = {
  prompt_edit: {
    tier: 'applicable',
    payloadShape: { find: 'string', replace: 'string' },
    guidance: {
      when: 'A small, exact section of the prompt is wrong (greeting, one rule, one missing sentence).',
      avoid: 'Large rewrites — use prompt_patch only when structure is deeply broken.',
      risk: 'low',
    },
    apply: (c, a, p) => {
      const result = applyPromptEdit(c, p.find, p.replace);
      return { config: result.config, actions: a };
    },
  },

  prompt_patch: {
    tier: 'applicable',
    payloadShape: { newPrompt: 'string' },
    guidance: {
      when: 'Prompt structure is broadly wrong and surgical edits cannot fix multiple linked failures.',
      avoid: 'Default choice. Prefer prompt_edit, guardrail, or escalation_rule first.',
      risk: 'high',
    },
    apply: (c, a, p) => ({
      config: { ...c, agentPrompt: p.newPrompt },
      actions: a,
    }),
  },

  welcome_message: {
    tier: 'applicable',
    payloadShape: { newMessage: 'string' },
    guidance: {
      when: 'First-turn greeting fails (missed hello, wrong brand, poor opener).',
      avoid: 'When failure is mid-call flow or tools.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: { ...c, welcomeMessage: p.newMessage },
      actions: a,
    }),
  },

  patience_level: {
    tier: 'applicable',
    payloadShape: { value: ['low', 'medium', 'high'] },
    guidance: {
      when: 'Agent interrupts, rushes, or leaves long awkward silence (turn-taking issues).',
      avoid: 'Content/compliance failures.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: { ...c, patienceLevel: p.value },
      actions: a,
    }),
  },

  max_call_duration: {
    tier: 'applicable',
    payloadShape: { seconds: 'int:180..900' },
    guidance: {
      when: 'Calls cut off before goal completion, or drag far past useful length.',
      avoid: 'Content quality issues.',
      risk: 'medium',
    },
    apply: (c, a, p) => ({
      config: { ...c, maxCallDuration: p.seconds },
      actions: a,
    }),
  },

  idle_reminder: {
    tier: 'applicable',
    payloadShape: { enabled: 'bool', afterSeconds: 'int:1..20' },
    guidance: {
      when: 'Callers go silent and agent does not re-engage.',
      avoid: 'Tool/booking failures.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: {
        ...c,
        sendUserIdleReminders: p.enabled,
        reminderAfterIdleTimeSeconds: p.afterSeconds,
      },
      actions: a,
    }),
  },

  action_add: {
    tier: 'applicable',
    // name is canonical; instructions optional (when/how to fire)
    payloadShape: {
      actionType: 'enum:GHL_ACTION_TYPES',
      name: 'string',
      actionParameters: 'object',
      instructions: 'string?',
    },
    guidance: {
      when: 'Agent needs a capability that does not exist (booking, transfer, webhook, KB).',
      avoid: 'When an existing action already covers the need — use action_update.',
      risk: 'medium',
    },
    apply: (c, a, p) => ({
      config: c,
      actions: [
        ...a,
        {
          pendingCreate: true,
          actionType: p.actionType,
          name: p.name,
          actionName: p.name,
          instructions: p.instructions,
          actionParameters: p.actionParameters || {},
        },
      ],
    }),
  },

  action_update: {
    tier: 'applicable',
    payloadShape: {
      actionId: 'string',
      changes: 'object',
    },
    guidance: {
      when: 'An existing tool exists but triggers wrong, has bad instructions, or wrong parameters.',
      avoid: 'Prompt-only issues with no tool involvement.',
      risk: 'medium',
    },
    apply: (c, a, p) => ({
      config: c,
      actions: a.map((x) => {
        const id = x.actionId || x.id;
        return id === p.actionId
          ? { ...x, ...p.changes, pendingUpdate: true }
          : x;
      }),
    }),
  },

  kb_attach: {
    tier: 'applicable',
    payloadShape: { faqEntries: 'array' },
    guidance: {
      when: 'Agent lacks factual answers that belong in a knowledge base / FAQ.',
      avoid: 'Behavioral/tone issues.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: c,
      actions: upsertKbAction(a, p.faqEntries),
    }),
  },

  escalation_rule: {
    tier: 'applicable',
    payloadShape: {
      trigger: 'string',
      promptAddition: 'string',
      transferAction: 'object?',
    },
    guidance: {
      when: 'Angry/complex callers need handoff; agent fails to escalate.',
      avoid: 'Simple greeting or data collection gaps.',
      risk: 'medium',
    },
    apply: (c, a, p) => ({
      config: {
        ...c,
        agentPrompt:
          (c.agentPrompt || '') + '\n\n## Escalation\n' + p.promptAddition,
      },
      actions: p.transferAction
        ? [
            ...a,
            {
              pendingCreate: true,
              actionType: 'CALL_TRANSFER',
              ...p.transferAction,
            },
          ]
        : a,
    }),
  },

  guardrail: {
    tier: 'applicable',
    payloadShape: { promptAddition: 'string' },
    guidance: {
      when: 'Need to forbid a behavior or force a required statement without rewriting the full prompt.',
      avoid: 'When a single existing paragraph should be edited — use prompt_edit.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: {
        ...c,
        agentPrompt:
          (c.agentPrompt || '') + '\n\n## Guardrail\n' + p.promptAddition,
      },
      actions: a,
    }),
  },

  advisory_temperature: {
    tier: 'advisory',
    payloadShape: { value: 'float:0..1' },
    guidance: {
      when: 'Agent is too random or too rigid; temperature is a plausible lever (sim only).',
      avoid: 'As a substitute for missing tools or wrong instructions.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: c,
      actions: a,
      simOverrides: { temperature: p.value },
    }),
  },

  advisory_model: {
    tier: 'advisory',
    payloadShape: { suggestion: 'string' },
    guidance: {
      when: 'Model capability is the bottleneck (sim/advisory only).',
      avoid: 'When prompt/tool fixes are clearer.',
      risk: 'low',
    },
    apply: (c, a, p) => ({
      config: c,
      actions: a,
      simOverrides: { model: p.suggestion },
    }),
  },
};

export const GHL_ACTION_TYPES = [
  'CALL_TRANSFER',
  'APPOINTMENT_BOOKING',
  'KNOWLEDGE_BASE',
  'WEBHOOK',
  'EXTERNAL_DATA',
  'CONVERSATION_END',
  'WORKFLOW_TRIGGER',
  'CUSTOM_FUNCTION',
];

/** Preferred order when choosing among types (surgical first) */
export const REC_TYPE_PREFERENCE = [
  'action_update',
  'action_add',
  'prompt_edit',
  'guardrail',
  'escalation_rule',
  'kb_attach',
  'welcome_message',
  'idle_reminder',
  'patience_level',
  'max_call_duration',
  'advisory_temperature',
  'advisory_model',
  'prompt_patch',
];

export function getRecTypeKeys() {
  return Object.keys(REC_TYPES);
}

export function isValidRecType(recType) {
  return recType in REC_TYPES;
}

export function getTier(recType) {
  if (!isValidRecType(recType)) {
    throw new Error(`Unknown rec_type: ${recType}`);
  }
  return REC_TYPES[recType].tier;
}

export function getPayloadShape(recType) {
  if (!isValidRecType(recType)) {
    throw new Error(`Unknown rec_type: ${recType}`);
  }
  return REC_TYPES[recType].payloadShape;
}

export function getRecTypeGuidance(recType) {
  if (!isValidRecType(recType)) return null;
  return REC_TYPES[recType].guidance || null;
}

/**
 * Build catalog text for LLM system prompts
 */
export function buildRecTypeCatalog() {
  return REC_TYPE_PREFERENCE.filter(isValidRecType)
    .map((key) => {
      const t = REC_TYPES[key];
      const g = t.guidance || {};
      const shape = JSON.stringify(t.payloadShape);
      return `- ${key} [tier=${t.tier}, risk=${g.risk || 'unknown'}]
  payloadShape: ${shape}
  when: ${g.when || 'n/a'}
  avoid: ${g.avoid || 'n/a'}`;
    })
    .join('\n');
}

export function applyRecommendation(recType, config, actions, payload) {
  if (!isValidRecType(recType)) {
    throw new Error(`Unknown rec_type: ${recType} - cannot apply`);
  }
  return REC_TYPES[recType].apply(config, actions, payload);
}

/**
 * Default risk for a rec type (for ranking)
 */
export function getDefaultRisk(recType) {
  return getRecTypeGuidance(recType)?.risk || 'medium';
}

/**
 * Preference rank (lower = more preferred / surgical)
 */
export function getPreferenceRank(recType) {
  const idx = REC_TYPE_PREFERENCE.indexOf(recType);
  return idx === -1 ? 99 : idx;
}
