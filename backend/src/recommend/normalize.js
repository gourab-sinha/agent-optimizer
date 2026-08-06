/**
 * Normalize LLM proposals before validation
 * - Field aliases (actionName → name, etc.)
 * - Default arrays
 * - Strip unknown noise lightly
 */

/**
 * Normalize a single raw proposal from the LLM
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeProposal(raw) {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const proposal = {
    recType: raw.recType || raw.rec_type || raw.type,
    payload: { ...(raw.payload || {}) },
    rationale: raw.rationale || raw.reason || '',
    linkedPatternIds: Array.isArray(raw.linkedPatternIds)
      ? raw.linkedPatternIds
      : Array.isArray(raw.linked_pattern_ids)
        ? raw.linked_pattern_ids
        : [],
    expectedCriterionIds: Array.isArray(raw.expectedCriterionIds)
      ? raw.expectedCriterionIds
      : Array.isArray(raw.expected_criterion_ids)
        ? raw.expected_criterion_ids
        : [],
    supportingTestCaseIds: Array.isArray(raw.supportingTestCaseIds)
      ? raw.supportingTestCaseIds
      : Array.isArray(raw.supporting_test_case_ids)
        ? raw.supporting_test_case_ids
        : [],
    confidence:
      typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(1, raw.confidence))
        : typeof raw.confidence === 'string'
          ? Math.max(0, Math.min(1, parseFloat(raw.confidence) || 0.5))
          : 0.5,
    risk: ['low', 'medium', 'high'].includes(raw.risk) ? raw.risk : undefined,
    rootCause: raw.rootCause || raw.root_cause || undefined,
  };

  // --- action_add aliases ---
  if (proposal.recType === 'action_add') {
    if (!proposal.payload.name && proposal.payload.actionName) {
      proposal.payload.name = proposal.payload.actionName;
    }
    delete proposal.payload.actionName;
    if (
      proposal.payload.actionParameters === undefined &&
      proposal.payload.parameters
    ) {
      proposal.payload.actionParameters = proposal.payload.parameters;
      delete proposal.payload.parameters;
    }
    if (proposal.payload.actionParameters === undefined) {
      proposal.payload.actionParameters = {};
    }
  }

  // --- action_update aliases ---
  if (proposal.recType === 'action_update') {
    if (!proposal.payload.actionId && proposal.payload.id) {
      proposal.payload.actionId = proposal.payload.id;
      delete proposal.payload.id;
    }
    if (!proposal.payload.changes || typeof proposal.payload.changes !== 'object') {
      // LLM sometimes puts fields at top level
      const { actionId, ...rest } = proposal.payload;
      if (Object.keys(rest).length > 0 && !proposal.payload.changes) {
        proposal.payload = { actionId, changes: rest };
      }
    }
    // Map actionName inside changes → name
    if (proposal.payload.changes?.actionName && !proposal.payload.changes.name) {
      proposal.payload.changes.name = proposal.payload.changes.actionName;
      delete proposal.payload.changes.actionName;
    }
  }

  // --- welcome_message aliases ---
  if (proposal.recType === 'welcome_message') {
    if (!proposal.payload.newMessage && proposal.payload.message) {
      proposal.payload.newMessage = proposal.payload.message;
      delete proposal.payload.message;
    }
  }

  // --- prompt_edit aliases ---
  if (proposal.recType === 'prompt_edit') {
    if (!proposal.payload.find && proposal.payload.search) {
      proposal.payload.find = proposal.payload.search;
      delete proposal.payload.search;
    }
    if (!proposal.payload.replace && proposal.payload.replacement) {
      proposal.payload.replace = proposal.payload.replacement;
      delete proposal.payload.replacement;
    }
  }

  // --- patience_level ---
  if (proposal.recType === 'patience_level') {
    if (proposal.payload.value === undefined && proposal.payload.level) {
      proposal.payload.value = proposal.payload.level;
      delete proposal.payload.level;
    }
  }

  return proposal;
}

/**
 * Normalize a list of proposals
 */
export function normalizeProposals(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProposal);
}

/**
 * Stable hash for dedupe (rec type + payload)
 */
export function proposalFingerprint(proposal) {
  const payload = proposal.payload || {};
  // Sort keys for stability
  const normalized = JSON.stringify(payload, Object.keys(payload).sort());
  return `${proposal.recType}::${normalized}`;
}
