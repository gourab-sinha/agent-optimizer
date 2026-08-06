/**
 * Validate - Deterministic validation of LLM proposals
 *
 * Pipeline per proposal:
 * 1. Normalize (aliases) — caller may pre-normalize
 * 2. recType + payload shape
 * 3. linked pattern / criterion / test case IDs
 * 4. Type-specific rules (prompt compliance, action existence, prompt_edit find)
 * 5. No-op detection
 * 6. Soft pattern↔criterion coherence
 * 7. Dedupe against DB open recommendations + in-batch
 */

import { createPatch } from 'diff';
import {
  isValidRecType,
  getTier,
  getPayloadShape,
  GHL_ACTION_TYPES,
  getDefaultRisk,
} from './recTypes.js';
import { normalizeProposal, proposalFingerprint } from './normalize.js';
import db from '../db/connection.js';

function validatePayloadShape(payload, shape) {
  for (const [key, expected] of Object.entries(shape)) {
    const value = payload[key];

    if (Array.isArray(expected)) {
      if (value === undefined) {
        return { valid: false, reason: `Missing required field: ${key}` };
      }
      if (!expected.includes(value)) {
        return {
          valid: false,
          reason: `${key} must be one of: ${expected.join(', ')}`,
        };
      }
      continue;
    }

    const isOptional = typeof expected === 'string' && expected.endsWith('?');
    const expectedType = isOptional ? expected.slice(0, -1) : expected;

    if (isOptional && value === undefined) {
      continue;
    }

    if (!isOptional && value === undefined) {
      return { valid: false, reason: `Missing required field: ${key}` };
    }

    if (expectedType === 'string') {
      if (typeof value !== 'string' || value.length === 0) {
        return { valid: false, reason: `${key} must be non-empty string` };
      }
    } else if (expectedType === 'bool') {
      if (typeof value !== 'boolean') {
        return { valid: false, reason: `${key} must be boolean` };
      }
    } else if (typeof expectedType === 'string' && expectedType.startsWith('int:')) {
      const rangeMatch = expectedType.match(/int:(\d+)\.\.(\d+)/);
      if (!rangeMatch) {
        return { valid: false, reason: `Invalid int range spec: ${expectedType}` };
      }
      const [, min, max] = rangeMatch;
      if (
        !Number.isInteger(value) ||
        value < parseInt(min) ||
        value > parseInt(max)
      ) {
        return {
          valid: false,
          reason: `${key} must be integer between ${min} and ${max}`,
        };
      }
    } else if (
      typeof expectedType === 'string' &&
      expectedType.startsWith('float:')
    ) {
      const rangeMatch = expectedType.match(/float:([\d.]+)\.\.([\d.]+)/);
      if (!rangeMatch) {
        return {
          valid: false,
          reason: `Invalid float range spec: ${expectedType}`,
        };
      }
      const [, min, max] = rangeMatch;
      if (
        typeof value !== 'number' ||
        value < parseFloat(min) ||
        value > parseFloat(max)
      ) {
        return {
          valid: false,
          reason: `${key} must be float between ${min} and ${max}`,
        };
      }
    } else if (
      typeof expectedType === 'string' &&
      expectedType.startsWith('enum:')
    ) {
      const enumName = expectedType.split(':')[1];
      if (enumName === 'GHL_ACTION_TYPES') {
        if (!GHL_ACTION_TYPES.includes(value)) {
          return {
            valid: false,
            reason: `${key} must be one of: ${GHL_ACTION_TYPES.join(', ')}`,
          };
        }
      } else {
        return { valid: false, reason: `Unknown enum type: ${enumName}` };
      }
    } else if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        return { valid: false, reason: `${key} must be an array` };
      }
    } else if (expectedType === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { valid: false, reason: `${key} must be an object` };
      }
    }
  }

  return { valid: true };
}

function validatePromptPatch(payload, currentPrompt) {
  const newPrompt = payload.newPrompt;

  if (!newPrompt || newPrompt.trim().length === 0) {
    return { valid: false, reason: 'newPrompt cannot be empty' };
  }

  if (newPrompt === currentPrompt) {
    return { valid: false, reason: 'newPrompt is identical to current prompt (no-op)' };
  }

  if (newPrompt.length > currentPrompt.length * 2) {
    return {
      valid: false,
      reason: `newPrompt too long (${newPrompt.length} chars, max ${currentPrompt.length * 2})`,
    };
  }

  // Limit rewrite size on multi-line prompts (single-line uses length ratio)
  const oldLines = currentPrompt.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (oldLines.length >= 4) {
    const oldSet = new Set(oldLines);
    const newLines = newPrompt.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const preserved = newLines.filter((l) => oldSet.has(l)).length;
    const preserveRatio = preserved / oldLines.length;
    if (preserveRatio < 0.4) {
      return {
        valid: false,
        reason: `prompt_patch rewrites too much (only ${(preserveRatio * 100).toFixed(0)}% of original lines preserved). Prefer prompt_edit or guardrail.`,
      };
    }
  } else if (currentPrompt.length > 80) {
    // Character-level: new prompt should share a substantial prefix or overlap
    const minKeep = Math.floor(currentPrompt.length * 0.35);
    const shared =
      [...currentPrompt].filter((ch, i) => newPrompt[i] === ch).length;
    // Prefer simpler check: at least 35% of original length still appears as substrings of first 200 chars chunks
    const head = currentPrompt.slice(0, Math.min(120, currentPrompt.length));
    if (!newPrompt.includes(head.slice(0, Math.min(40, head.length))) && shared < minKeep) {
      // Allow if compliance-bearing sentences already validated; only warn-level reject when totally rewritten
      const oldTokens = new Set(currentPrompt.toLowerCase().split(/\s+/).filter((t) => t.length > 3));
      const newTokens = newPrompt.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
      const overlap = newTokens.filter((t) => oldTokens.has(t)).length;
      const tokenRatio = oldTokens.size > 0 ? overlap / oldTokens.size : 1;
      if (tokenRatio < 0.35) {
        return {
          valid: false,
          reason:
            'prompt_patch changes almost all content. Prefer prompt_edit or guardrail for surgical fixes.',
        };
      }
    }
  }

  const compliancePatterns = [
    /opt[- ]?out/i,
    /don't call/i,
    /do not call/i,
    /tcpa/i,
    /compliance/i,
  ];

  for (const pattern of compliancePatterns) {
    const originalMatch = currentPrompt.match(pattern);
    if (originalMatch) {
      const sentences = currentPrompt.split(/[.!?]+/);
      const matchingSentence = sentences.find((s) => pattern.test(s));

      if (matchingSentence && !newPrompt.includes(matchingSentence.trim())) {
        return {
          valid: false,
          reason: `newPrompt removed compliance/opt-out language: "${matchingSentence.trim().substring(0, 80)}..."`,
        };
      }
    }
  }

  payload.diff = createPatch('prompt', currentPrompt, newPrompt, '', '');
  return { valid: true };
}

function validatePromptEdit(payload, currentPrompt) {
  const { find, replace } = payload;
  if (!find || !replace) {
    return { valid: false, reason: 'prompt_edit requires find and replace' };
  }
  if (find === replace) {
    return { valid: false, reason: 'prompt_edit find and replace are identical (no-op)' };
  }
  if (!currentPrompt.includes(find)) {
    return {
      valid: false,
      reason: 'prompt_edit find string not found verbatim in current prompt',
    };
  }
  // Count occurrences — warn-level as soft reject if too many
  const occurrences = currentPrompt.split(find).length - 1;
  if (occurrences > 3) {
    return {
      valid: false,
      reason: `prompt_edit find matches ${occurrences} times (ambiguous). Use a longer unique find string.`,
    };
  }
  return { valid: true };
}

function validateActionUpdate(payload, actions) {
  const { actionId, changes } = payload;

  if (!actions.find((a) => a.actionId === actionId || a.id === actionId)) {
    return {
      valid: false,
      reason: `actionId ${actionId} not found in agent's actions`,
    };
  }

  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return { valid: false, reason: 'changes must be a non-empty object' };
  }

  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (keys.length === 0) {
    return { valid: false, reason: 'changes is empty (no-op)' };
  }

  return { valid: true };
}

function isNoOp(proposal, agentConfig) {
  const { recType, payload } = proposal;
  if (recType === 'welcome_message') {
    if (payload.newMessage === agentConfig.welcomeMessage) {
      return 'welcome_message matches current (no-op)';
    }
  }
  if (recType === 'patience_level') {
    if (payload.value === agentConfig.patienceLevel) {
      return 'patience_level matches current (no-op)';
    }
  }
  if (recType === 'max_call_duration') {
    if (payload.seconds === agentConfig.maxCallDuration) {
      return 'max_call_duration matches current (no-op)';
    }
  }
  if (recType === 'kb_attach') {
    if (!Array.isArray(payload.faqEntries) || payload.faqEntries.length === 0) {
      return 'kb_attach faqEntries is empty (no-op)';
    }
  }
  if (recType === 'guardrail' || recType === 'escalation_rule') {
    const addition = payload.promptAddition || '';
    if (agentConfig.prompt && agentConfig.prompt.includes(addition.trim()) && addition.trim().length > 20) {
      return 'promptAddition already present in prompt (no-op)';
    }
  }
  return null;
}

/**
 * Soft check: at least one expected criterion should match a linked pattern's criterion
 */
function softPatternCriterionCoherence(proposal, patternMeta) {
  const linked = proposal.linkedPatternIds || [];
  const expected = new Set(proposal.expectedCriterionIds || []);
  if (linked.length === 0 || expected.size === 0) return null;

  let anyMatch = false;
  for (const pid of linked) {
    const meta = patternMeta.get(pid);
    if (meta?.criterionId && expected.has(meta.criterionId)) {
      anyMatch = true;
      break;
    }
  }
  if (!anyMatch) {
    // Soft: attach primary criterion from first pattern rather than reject
    const first = patternMeta.get(linked[0]);
    if (first?.criterionId) {
      proposal.expectedCriterionIds = Array.from(
        new Set([first.criterionId, ...proposal.expectedCriterionIds])
      );
      proposal._coherenceRepaired = true;
    }
  }
  return null;
}

async function loadExistingFingerprints(agentVersionId) {
  const result = await db.query(
    `SELECT rec_type, payload
     FROM recommendations
     WHERE agent_version_id = $1
       AND is_deleted = false
       AND status IN ('proposed', 'accepted', 'applied', 'verified_up')`,
    [agentVersionId]
  );

  const set = new Set();
  for (const row of result.rows) {
    set.add(
      proposalFingerprint({
        recType: row.rec_type,
        payload: row.payload || {},
      })
    );
  }
  return set;
}

async function validateProposal(proposal, context) {
  const {
    agentVersionId,
    patterns,
    criteria,
    testCases,
    currentPrompt,
    actions,
    agentConfig,
    patternMeta,
    existingFingerprints,
    batchFingerprints,
  } = context;

  proposal = normalizeProposal(proposal);

  if (!isValidRecType(proposal.recType)) {
    return { valid: false, reason: `Unknown recType: ${proposal.recType}` };
  }

  const tier = getTier(proposal.recType);
  const payloadShape = getPayloadShape(proposal.recType);
  const shapeResult = validatePayloadShape(proposal.payload || {}, payloadShape);
  if (!shapeResult.valid) {
    return { valid: false, reason: `Payload shape error: ${shapeResult.reason}` };
  }

  if (
    !Array.isArray(proposal.linkedPatternIds) ||
    proposal.linkedPatternIds.length === 0
  ) {
    return { valid: false, reason: 'linkedPatternIds must be non-empty array' };
  }

  for (const patternId of proposal.linkedPatternIds) {
    if (!patterns.has(patternId)) {
      return { valid: false, reason: `linkedPatternId ${patternId} not found` };
    }
  }

  if (
    !Array.isArray(proposal.expectedCriterionIds) ||
    proposal.expectedCriterionIds.length === 0
  ) {
    // Auto-fill from first linked pattern when possible
    const first = patternMeta.get(proposal.linkedPatternIds[0]);
    if (first?.criterionId && criteria.has(first.criterionId)) {
      proposal.expectedCriterionIds = [first.criterionId];
    } else {
      return {
        valid: false,
        reason: 'expectedCriterionIds must be non-empty array',
      };
    }
  }

  for (const criterionId of proposal.expectedCriterionIds) {
    if (!criteria.has(criterionId)) {
      return {
        valid: false,
        reason: `expectedCriterionId ${criterionId} not found in rubric`,
      };
    }
  }

  if (!Array.isArray(proposal.supportingTestCaseIds)) {
    proposal.supportingTestCaseIds = [];
  }

  for (const testCaseId of proposal.supportingTestCaseIds) {
    if (!testCases.has(testCaseId)) {
      return {
        valid: false,
        reason: `supportingTestCaseId ${testCaseId} not found`,
      };
    }
  }

  // Type-specific
  if (proposal.recType === 'prompt_patch') {
    const promptResult = validatePromptPatch(proposal.payload, currentPrompt);
    if (!promptResult.valid) return promptResult;
  } else if (proposal.recType === 'prompt_edit') {
    const editResult = validatePromptEdit(proposal.payload, currentPrompt);
    if (!editResult.valid) return editResult;
  } else if (proposal.recType === 'action_update') {
    const actionResult = validateActionUpdate(proposal.payload, actions);
    if (!actionResult.valid) return actionResult;
  }

  const noOp = isNoOp(proposal, agentConfig);
  if (noOp) {
    return { valid: false, reason: noOp };
  }

  softPatternCriterionCoherence(proposal, patternMeta);

  // Cap: only one prompt_patch per batch (checked by caller via context)
  if (proposal.recType === 'prompt_patch' && context.promptPatchAccepted) {
    return {
      valid: false,
      reason: 'Only one prompt_patch allowed per generation batch',
    };
  }

  const fp = proposalFingerprint(proposal);
  if (existingFingerprints.has(fp) || batchFingerprints.has(fp)) {
    return {
      valid: false,
      reason: 'Duplicate of an existing or in-batch recommendation',
    };
  }

  if (!proposal.risk) {
    proposal.risk = getDefaultRisk(proposal.recType);
  }

  return {
    valid: true,
    validated: {
      ...proposal,
      tier,
      agent_version_id: agentVersionId,
      fingerprint: fp,
    },
  };
}

/**
 * Validate all proposals and insert survivors
 *
 * @param {Array} proposals
 * @param {string} agentVersionId
 * @param {Object} agentConfig - from assembleInput.agent
 * @param {Object} [options]
 * @param {Array} [options.patternsDetail] - full pattern objects for criterion coherence
 * @returns {Promise<{accepted: Array, rejected: Array}>}
 */
export async function validateAndInsert(
  proposals,
  agentVersionId,
  agentConfig,
  options = {}
) {
  console.log(`\n✅ Validating ${proposals.length} proposals...`);

  const [patternsResult, criteriaResult, testCasesResult, existingFingerprints] =
    await Promise.all([
      db.query(
        `SELECT id, criterion_id FROM issue_patterns
         WHERE agent_version_id = $1 AND is_deleted = false`,
        [agentVersionId]
      ),
      db.query(
        `SELECT c.id FROM rubric_criteria c
         JOIN rubrics r ON c.rubric_id = r.id
         WHERE r.agent_version_id = $1
           AND r.is_deleted = false
           AND c.is_deleted = false`,
        [agentVersionId]
      ),
      db.query(
        `SELECT tc.id FROM test_cases tc
         WHERE tc.agent_id = (
           SELECT agent_id FROM agent_versions WHERE id = $1
         ) AND tc.is_deleted = false`,
        [agentVersionId]
      ),
      loadExistingFingerprints(agentVersionId),
    ]);

  const patterns = new Set(patternsResult.rows.map((r) => r.id));
  const criteria = new Set(criteriaResult.rows.map((r) => r.id));
  const testCases = new Set(testCasesResult.rows.map((r) => r.id));

  const patternMeta = new Map();
  for (const row of patternsResult.rows) {
    patternMeta.set(row.id, { criterionId: row.criterion_id });
  }
  // Prefer detail from assemble if provided
  if (Array.isArray(options.patternsDetail)) {
    for (const p of options.patternsDetail) {
      patternMeta.set(p.id, {
        criterionId: p.criterionId || p.criterion_id,
      });
    }
  }

  const context = {
    agentVersionId,
    patterns,
    criteria,
    testCases,
    currentPrompt: agentConfig.prompt || '',
    actions: agentConfig.actions || [],
    agentConfig,
    patternMeta,
    existingFingerprints,
    batchFingerprints: new Set(),
    promptPatchAccepted: false,
  };

  const accepted = [];
  const rejected = [];

  for (const raw of proposals) {
    const result = await validateProposal(raw, context);

    if (result.valid) {
      accepted.push(result.validated);
      context.batchFingerprints.add(result.validated.fingerprint);
      if (result.validated.recType === 'prompt_patch') {
        context.promptPatchAccepted = true;
      }
    } else {
      rejected.push({
        proposal: raw,
        reason: result.reason,
      });
      console.log(
        `   ✗ Rejected (${raw?.recType || raw?.rec_type || '?'}): ${result.reason}`
      );
    }
  }

  console.log(`   ✓ Accepted: ${accepted.length}`);
  console.log(`   ✗ Rejected: ${rejected.length}`);

  if (accepted.length > 0) {
    for (const rec of accepted) {
      await db.query(
        `INSERT INTO recommendations (
          agent_version_id,
          tier,
          rec_type,
          payload,
          rationale,
          linked_pattern_ids,
          expected_criterion_ids,
          supporting_test_case_ids,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'proposed')`,
        [
          rec.agent_version_id,
          rec.tier,
          rec.recType,
          JSON.stringify({
            ...rec.payload,
            // Persist ranking metadata inside payload for UI without schema migration
            _meta: {
              confidence: rec.confidence,
              risk: rec.risk,
              rootCause: rec.rootCause,
              priorityScore: rec.priorityScore,
            },
          }),
          rec.rationale,
          rec.linkedPatternIds,
          rec.expectedCriterionIds,
          rec.supportingTestCaseIds || [],
        ]
      );
    }
    console.log(`   ✓ Inserted ${accepted.length} recommendations into database`);
  }

  return { accepted, rejected };
}
