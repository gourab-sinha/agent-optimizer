/**
 * Validate - Deterministic validation of LLM proposals
 *
 * Each proposal is validated in order. Any failure -> proposal dropped with logged reason.
 * Returns both accepted and rejected lists for observability.
 */

import { createPatch } from 'diff';
import { isValidRecType, getTier, getPayloadShape, GHL_ACTION_TYPES } from './recTypes.js';
import db from '../db/connection.js';

/**
 * Shape checker - validates payload against payloadShape schema
 */
function validatePayloadShape(payload, shape) {
  for (const [key, expected] of Object.entries(shape)) {
    const value = payload[key];

    // Enum arrays are stored as actual arrays in payloadShape (e.g. patience_level)
    if (Array.isArray(expected)) {
      if (value === undefined) {
        return { valid: false, reason: `Missing required field: ${key}` };
      }
      if (!expected.includes(value)) {
        return { valid: false, reason: `${key} must be one of: ${expected.join(', ')}` };
      }
      continue;
    }

    const isOptional = typeof expected === 'string' && expected.endsWith('?');
    const expectedType = isOptional ? expected.slice(0, -1) : expected;

    // Optional field can be undefined
    if (isOptional && value === undefined) {
      continue;
    }

    // Required field must exist
    if (!isOptional && value === undefined) {
      return { valid: false, reason: `Missing required field: ${key}` };
    }

    // Type validation
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
      if (!Number.isInteger(value) || value < parseInt(min) || value > parseInt(max)) {
        return { valid: false, reason: `${key} must be integer between ${min} and ${max}` };
      }
    } else if (typeof expectedType === 'string' && expectedType.startsWith('float:')) {
      const rangeMatch = expectedType.match(/float:([\d.]+)\.\.([\d.]+)/);
      if (!rangeMatch) {
        return { valid: false, reason: `Invalid float range spec: ${expectedType}` };
      }
      const [, min, max] = rangeMatch;
      if (typeof value !== 'number' || value < parseFloat(min) || value > parseFloat(max)) {
        return { valid: false, reason: `${key} must be float between ${min} and ${max}` };
      }
    } else if (typeof expectedType === 'string' && expectedType.startsWith('enum:')) {
      const enumName = expectedType.split(':')[1];
      if (enumName === 'GHL_ACTION_TYPES') {
        if (!GHL_ACTION_TYPES.includes(value)) {
          return { valid: false, reason: `${key} must be one of: ${GHL_ACTION_TYPES.join(', ')}` };
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

/**
 * Validate prompt_patch specific rules
 */
async function validatePromptPatch(payload, currentPrompt) {
  const newPrompt = payload.newPrompt;

  // Must be non-empty
  if (!newPrompt || newPrompt.trim().length === 0) {
    return { valid: false, reason: 'newPrompt cannot be empty' };
  }

  // Cannot be more than 2x the current prompt length
  if (newPrompt.length > currentPrompt.length * 2) {
    return { valid: false, reason: `newPrompt too long (${newPrompt.length} chars, max ${currentPrompt.length * 2})` };
  }

  // Must preserve opt-out/compliance sentences
  const compliancePatterns = [
    /opt[- ]?out/i,
    /don't call/i,
    /do not call/i,
    /tcpa/i,
    /compliance/i
  ];

  for (const pattern of compliancePatterns) {
    // Check if original has this pattern
    const originalMatch = currentPrompt.match(pattern);
    if (originalMatch) {
      // Find the sentence containing the match
      const sentences = currentPrompt.split(/[.!?]+/);
      const matchingSentence = sentences.find(s => pattern.test(s));

      if (matchingSentence && !newPrompt.includes(matchingSentence.trim())) {
        return {
          valid: false,
          reason: `newPrompt removed compliance/opt-out language: "${matchingSentence.trim().substring(0, 80)}..."`
        };
      }
    }
  }

  // Generate diff and add to payload
  const diff = createPatch('prompt', currentPrompt, newPrompt, '', '');
  payload.diff = diff;

  return { valid: true };
}

/**
 * Validate action_update specific rules
 */
async function validateActionUpdate(payload, actions) {
  const { actionId } = payload;

  if (!actions.find(a => a.actionId === actionId)) {
    return { valid: false, reason: `actionId ${actionId} not found in agent's actions` };
  }

  return { valid: true };
}

/**
 * Validate a single proposal
 *
 * @param {Object} proposal - LLM proposal
 * @param {Object} context - Validation context (agentVersionId, patterns, criteria, testCases, currentPrompt, actions)
 * @returns {Promise<{valid: boolean, reason?: string, validated?: Object}>}
 */
async function validateProposal(proposal, context) {
  const { agentVersionId, patterns, criteria, testCases, currentPrompt, actions } = context;

  // 1. recType must be valid
  if (!isValidRecType(proposal.recType)) {
    return { valid: false, reason: `Unknown recType: ${proposal.recType}` };
  }

  // 2. Tier is ALWAYS set from REC_TYPES, never from LLM
  const tier = getTier(proposal.recType);

  // 3. Payload must match payloadShape
  const payloadShape = getPayloadShape(proposal.recType);
  const shapeResult = validatePayloadShape(proposal.payload, payloadShape);
  if (!shapeResult.valid) {
    return { valid: false, reason: `Payload shape error: ${shapeResult.reason}` };
  }

  // 4. linkedPatternIds must be non-empty and exist
  if (!Array.isArray(proposal.linkedPatternIds) || proposal.linkedPatternIds.length === 0) {
    return { valid: false, reason: 'linkedPatternIds must be non-empty array' };
  }

  for (const patternId of proposal.linkedPatternIds) {
    if (!patterns.has(patternId)) {
      return { valid: false, reason: `linkedPatternId ${patternId} not found` };
    }
  }

  // 5. expectedCriterionIds must be non-empty and exist
  if (!Array.isArray(proposal.expectedCriterionIds) || proposal.expectedCriterionIds.length === 0) {
    return { valid: false, reason: 'expectedCriterionIds must be non-empty array' };
  }

  for (const criterionId of proposal.expectedCriterionIds) {
    if (!criteria.has(criterionId)) {
      return { valid: false, reason: `expectedCriterionId ${criterionId} not found in rubric` };
    }
  }

  // 6. supportingTestCaseIds must all exist (can be empty)
  if (!Array.isArray(proposal.supportingTestCaseIds)) {
    proposal.supportingTestCaseIds = [];
  }

  for (const testCaseId of proposal.supportingTestCaseIds) {
    if (!testCases.has(testCaseId)) {
      return { valid: false, reason: `supportingTestCaseId ${testCaseId} not found` };
    }
  }

  // 7. Type-specific validation
  if (proposal.recType === 'prompt_patch') {
    const promptResult = await validatePromptPatch(proposal.payload, currentPrompt);
    if (!promptResult.valid) {
      return promptResult;
    }
  } else if (proposal.recType === 'action_update') {
    const actionResult = await validateActionUpdate(proposal.payload, actions);
    if (!actionResult.valid) {
      return actionResult;
    }
  }

  // All validations passed
  return {
    valid: true,
    validated: {
      ...proposal,
      tier, // Override with correct tier from REC_TYPES
      agent_version_id: agentVersionId
    }
  };
}

/**
 * Validate all proposals and insert survivors into database
 *
 * @param {Array} proposals - Raw LLM proposals
 * @param {string} agentVersionId - Agent version UUID
 * @param {Object} agentConfig - Current agent config (from assembleInput)
 * @returns {Promise<{accepted: Array, rejected: Array}>}
 */
export async function validateAndInsert(proposals, agentVersionId, agentConfig) {
  console.log(`\n✅ Validating ${proposals.length} proposals...`);

  // Load validation context
  const [patternsResult, criteriaResult, testCasesResult] = await Promise.all([
    db.query(
      `SELECT id FROM issue_patterns
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
    )
  ]);

  const patterns = new Set(patternsResult.rows.map(r => r.id));
  const criteria = new Set(criteriaResult.rows.map(r => r.id));
  const testCases = new Set(testCasesResult.rows.map(r => r.id));

  const context = {
    agentVersionId,
    patterns,
    criteria,
    testCases,
    currentPrompt: agentConfig.prompt,
    actions: agentConfig.actions
  };

  const accepted = [];
  const rejected = [];

  for (const proposal of proposals) {
    const result = await validateProposal(proposal, context);

    if (result.valid) {
      accepted.push(result.validated);
    } else {
      rejected.push({
        proposal,
        reason: result.reason
      });
      console.log(`   ✗ Rejected (${proposal.recType}): ${result.reason}`);
    }
  }

  console.log(`   ✓ Accepted: ${accepted.length}`);
  console.log(`   ✗ Rejected: ${rejected.length}`);

  // Insert accepted proposals
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
          JSON.stringify(rec.payload),
          rec.rationale,
          rec.linkedPatternIds,
          rec.expectedCriterionIds,
          rec.supportingTestCaseIds || []
        ]
      );
    }
    console.log(`   ✓ Inserted ${accepted.length} recommendations into database`);
  }

  return { accepted, rejected };
}
