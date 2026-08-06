/**
 * Recommendation Types - Single Source of Truth
 *
 * This file defines all valid recommendation types, their tiers, payload schemas,
 * and pure apply functions. The LLM never sets tier - it's always taken from this table.
 */

/**
 * Helper function to merge a knowledge base action into actions array
 */
function upsertKbAction(actions, faqEntries) {
  const kbActionIndex = actions.findIndex(a => a.actionType === 'KNOWLEDGE_BASE');

  if (kbActionIndex >= 0) {
    // Update existing knowledge base action
    const existingKb = actions[kbActionIndex];
    const existingEntries = existingKb.actionParameters?.faqEntries || [];

    return actions.map((action, idx) =>
      idx === kbActionIndex
        ? {
            ...action,
            actionParameters: {
              ...action.actionParameters,
              faqEntries: [...existingEntries, ...faqEntries]
            },
            pendingUpdate: true
          }
        : action
    );
  } else {
    // Create new knowledge base action
    return [
      ...actions,
      {
        pendingCreate: true,
        actionType: 'KNOWLEDGE_BASE',
        name: 'Knowledge Base',
        actionParameters: { faqEntries }
      }
    ];
  }
}

/**
 * REC_TYPES - Whitelist of all valid recommendation types
 *
 * tier: ALWAYS set from this table, never from LLM
 * payloadShape: Schema for validating payload structure
 * apply: Pure function (config, actions, payload) => {config, actions, simOverrides?}
 */
export const REC_TYPES = {
  prompt_patch: {
    tier: 'applicable',
    payloadShape: { newPrompt: 'string' },
    apply: (c, a, p) => ({
      config: { ...c, agentPrompt: p.newPrompt },
      actions: a
    }),
  },

  welcome_message: {
    tier: 'applicable',
    payloadShape: { newMessage: 'string' },
    apply: (c, a, p) => ({
      config: { ...c, welcomeMessage: p.newMessage },
      actions: a
    }),
  },

  patience_level: {
    tier: 'applicable',
    payloadShape: { value: ['low', 'medium', 'high'] },
    apply: (c, a, p) => ({
      config: { ...c, patienceLevel: p.value },
      actions: a
    }),
  },

  max_call_duration: {
    tier: 'applicable',
    payloadShape: { seconds: 'int:180..900' },
    apply: (c, a, p) => ({
      config: { ...c, maxCallDuration: p.seconds },
      actions: a
    }),
  },

  idle_reminder: {
    tier: 'applicable',
    payloadShape: { enabled: 'bool', afterSeconds: 'int:1..20' },
    apply: (c, a, p) => ({
      config: {
        ...c,
        sendUserIdleReminders: p.enabled,
        reminderAfterIdleTimeSeconds: p.afterSeconds
      },
      actions: a
    }),
  },

  action_add: {
    tier: 'applicable',
    payloadShape: {
      actionType: 'enum:GHL_ACTION_TYPES',
      name: 'string',
      actionParameters: 'object'
    },
    apply: (c, a, p) => ({
      config: c,
      actions: [...a, { pendingCreate: true, ...p }]
    }),
  },

  action_update: {
    tier: 'applicable',
    payloadShape: {
      actionId: 'string',
      changes: 'object'
    },
    apply: (c, a, p) => ({
      config: c,
      actions: a.map(x =>
        x.actionId === p.actionId
          ? { ...x, ...p.changes, pendingUpdate: true }
          : x
      )
    }),
  },

  kb_attach: {
    tier: 'applicable',
    payloadShape: { faqEntries: 'array' },
    apply: (c, a, p) => ({
      config: c,
      actions: upsertKbAction(a, p.faqEntries)
    }),
  },

  escalation_rule: {
    tier: 'applicable',
    payloadShape: {
      trigger: 'string',
      promptAddition: 'string',
      transferAction: 'object?'
    },
    apply: (c, a, p) => ({
      config: {
        ...c,
        agentPrompt: c.agentPrompt + '\n\n## Escalation\n' + p.promptAddition
      },
      actions: p.transferAction
        ? [...a, {
            pendingCreate: true,
            actionType: 'CALL_TRANSFER',
            ...p.transferAction
          }]
        : a
    }),
  },

  guardrail: {
    tier: 'applicable',
    payloadShape: { promptAddition: 'string' },
    apply: (c, a, p) => ({
      config: {
        ...c,
        agentPrompt: c.agentPrompt + '\n\n## Guardrail\n' + p.promptAddition
      },
      actions: a
    }),
  },

  // Advisory recommendations - not writable via HighLevel API
  // Verified empirically in simulation harness via agent_versions.sim_overrides
  advisory_temperature: {
    tier: 'advisory',
    payloadShape: { value: 'float:0..1' },
    apply: (c, a, p) => ({
      config: c,
      actions: a,
      simOverrides: { temperature: p.value }
    }),
  },

  advisory_model: {
    tier: 'advisory',
    payloadShape: { suggestion: 'string' },
    apply: (c, a, p) => ({
      config: c,
      actions: a,
      simOverrides: { model: p.suggestion }
    }),
  },
};

/**
 * Valid HighLevel action types
 */
export const GHL_ACTION_TYPES = [
  'CALL_TRANSFER',
  'APPOINTMENT_BOOKING',
  'KNOWLEDGE_BASE',
  'WEBHOOK',
  'EXTERNAL_DATA',
  'CONVERSATION_END',
  'WORKFLOW_TRIGGER',
  'CUSTOM_FUNCTION'
];

/**
 * Get all valid recommendation type keys
 */
export function getRecTypeKeys() {
  return Object.keys(REC_TYPES);
}

/**
 * Check if a rec_type is valid
 */
export function isValidRecType(recType) {
  return recType in REC_TYPES;
}

/**
 * Get tier for a recommendation type
 */
export function getTier(recType) {
  if (!isValidRecType(recType)) {
    throw new Error(`Unknown rec_type: ${recType}`);
  }
  return REC_TYPES[recType].tier;
}

/**
 * Get payload shape for a recommendation type
 */
export function getPayloadShape(recType) {
  if (!isValidRecType(recType)) {
    throw new Error(`Unknown rec_type: ${recType}`);
  }
  return REC_TYPES[recType].payloadShape;
}

/**
 * Apply a recommendation's payload to config and actions
 *
 * @param {string} recType - The recommendation type
 * @param {Object} config - Current agent config
 * @param {Array} actions - Current actions array
 * @param {Object} payload - Recommendation payload
 * @returns {{config: Object, actions: Array, simOverrides?: Object}}
 */
export function applyRecommendation(recType, config, actions, payload) {
  if (!isValidRecType(recType)) {
    throw new Error(`Unknown rec_type: ${recType} - cannot apply`);
  }

  const applyFn = REC_TYPES[recType].apply;
  return applyFn(config, actions, payload);
}
