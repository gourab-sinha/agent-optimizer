import db from '../db/connection.js';
import { callLLM } from './llmService.js';

/**
 * Pattern Detection Service
 * Identifies recurring issues from evaluation findings
 */

/**
 * Calculate impact score for a pattern
 * Formula: (fail_count / call_count) * severity * confidence_avg
 *
 * @param {number} failCount - Number of failures
 * @param {number} callCount - Total calls evaluated
 * @param {number} severity - Criterion severity (1-3)
 * @param {number} avgConfidence - Average confidence (0-1)
 * @returns {number} Impact score (0-3)
 */
function calculateImpactScore(failCount, callCount, severity, avgConfidence) {
  if (callCount === 0) return 0;
  const failureRate = failCount / callCount;
  return failureRate * severity * avgConfidence;
}

/**
 * Generate pattern title and description using LLM
 *
 * @param {Object} criterion - Rubric criterion
 * @param {Array} sampleFindings - Sample findings for context
 * @returns {Promise<Object>} { title, description }
 */
async function generatePatternSummary(criterion, sampleFindings) {
  const prompt = `You are analyzing recurring failures in voice AI agent calls.

Criterion: ${criterion.key}
Description: ${criterion.description}
Severity: ${criterion.severity}/3

Sample failures (${sampleFindings.length} examples):
${sampleFindings.slice(0, 5).map((f, i) => `${i + 1}. ${f.rationale}`).join('\n')}

Generate a concise pattern summary:
1. Title (5-7 words, actionable): What's the issue?
2. Description (1-2 sentences): Why does this matter and what's the impact?

Format your response as JSON:
{
  "title": "...",
  "description": "..."
}`;

  const result = await callLLM({
    prompt,
    systemPrompt: 'You are an expert at identifying patterns in voice AI agent performance. Generate concise, actionable summaries.',
    stage: 'pattern',
    temperature: 0.3,
    maxTokens: 200
  });

  try {
    // callLLM returns { content }, not completion
    const raw = result.content ?? result.completion;
    // Strip markdown fences if present
    let cleaned = (raw || '').trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
    }
    return JSON.parse(cleaned);
  } catch (err) {
    // Fallback if LLM doesn't return valid JSON
    return {
      title: `${criterion.key} failures`,
      description: `Agent frequently fails "${criterion.key}" criterion with ${sampleFindings.length} failures detected.`
    };
  }
}

/**
 * Detect patterns for a specific rubric
 *
 * @param {string} rubricId - Rubric UUID
 * @param {Object} options - Detection options
 * @param {number} options.minFailCount - Minimum failures to consider a pattern (default: 3)
 * @param {number} options.minImpactScore - Minimum impact score (default: 0.3)
 * @returns {Promise<Object>} Detection results with patterns
 */
export async function detectPatterns(rubricId, options = {}) {
  const {
    minFailCount = 3,
    minImpactScore = 0.3
  } = options;

  console.log(`\n🔍 Detecting patterns for rubric ${rubricId}`);
  console.log(`   Thresholds: ${minFailCount}+ failures, ${minImpactScore}+ impact`);

  // Get rubric details
  const rubricResult = await db.query(
    `SELECT r.id, r.agent_version_id, av.agent_id
     FROM rubrics r
     JOIN agent_versions av ON r.agent_version_id = av.id
     WHERE r.id = $1 AND r.is_deleted = false`,
    [rubricId]
  );

  if (rubricResult.rows.length === 0) {
    throw new Error(`Rubric ${rubricId} not found`);
  }

  const rubric = rubricResult.rows[0];

  // Analyze failures by criterion
  const analysisResult = await db.query(
    `SELECT
       f.criterion_id,
       rc.key as criterion_key,
       rc.description as criterion_description,
       rc.severity,
       rc.check_type,
       COUNT(DISTINCT f.call_id) as call_count,
       COUNT(DISTINCT CASE WHEN f.status = 'fail' THEN f.call_id END) as fail_count,
       AVG(CASE WHEN f.status = 'fail' THEN f.confidence ELSE NULL END) as avg_confidence,
       ARRAY_AGG(f.id) FILTER (WHERE f.status = 'fail') as failing_finding_ids
     FROM findings f
     JOIN rubric_criteria rc ON f.criterion_id = rc.id
     WHERE f.rubric_id = $1 AND f.is_deleted = false
     GROUP BY f.criterion_id, rc.key, rc.description, rc.severity, rc.check_type
     HAVING COUNT(DISTINCT CASE WHEN f.status = 'fail' THEN f.call_id END) >= $2`,
    [rubricId, minFailCount]
  );

  console.log(`   Found ${analysisResult.rows.length} criteria with ${minFailCount}+ failures`);

  const patterns = [];
  const skippedLowImpact = [];

  for (const row of analysisResult.rows) {
    const impactScore = calculateImpactScore(
      row.fail_count,
      row.call_count,
      row.severity,
      row.avg_confidence || 0.5
    );

    console.log(`   → ${row.criterion_key}: ${row.fail_count}/${row.call_count} failures, impact ${impactScore.toFixed(2)}`);

    if (impactScore < minImpactScore) {
      skippedLowImpact.push(row.criterion_key);
      continue;
    }

    // Get sample findings for LLM context
    const sampleFindingsResult = await db.query(
      `SELECT id, rationale, confidence
       FROM findings
       WHERE criterion_id = $1 AND status = 'fail' AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 5`,
      [row.criterion_id]
    );

    const sampleFindings = sampleFindingsResult.rows;

    // Generate pattern summary using LLM
    const summary = await generatePatternSummary({
      key: row.criterion_key,
      description: row.criterion_description,
      severity: row.severity
    }, sampleFindings);

    // Check if pattern already exists
    const existingPattern = await db.query(
      `SELECT id FROM issue_patterns
       WHERE rubric_id = $1 AND criterion_id = $2 AND is_deleted = false`,
      [rubricId, row.criterion_id]
    );

    let patternId;

    if (existingPattern.rows.length > 0) {
      // Update existing pattern
      const updateResult = await db.query(
        `UPDATE issue_patterns
         SET title = $1,
             description = $2,
             fail_count = $3,
             call_count = $4,
             impact_score = $5,
             representative_finding_ids = $6,
             updated_at = now()
         WHERE id = $7
         RETURNING id`,
        [
          summary.title,
          summary.description,
          row.fail_count,
          row.call_count,
          impactScore,
          row.failing_finding_ids,
          existingPattern.rows[0].id
        ]
      );
      patternId = updateResult.rows[0].id;
      console.log(`   ✓ Updated pattern: ${summary.title}`);
    } else {
      // Create new pattern
      const insertResult = await db.query(
        `INSERT INTO issue_patterns (
           agent_version_id,
           rubric_id,
           criterion_id,
           title,
           description,
           fail_count,
           call_count,
           impact_score,
           representative_finding_ids
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          rubric.agent_version_id,
          rubricId,
          row.criterion_id,
          summary.title,
          summary.description,
          row.fail_count,
          row.call_count,
          impactScore,
          row.failing_finding_ids
        ]
      );
      patternId = insertResult.rows[0].id;
      console.log(`   ✓ Created pattern: ${summary.title}`);
    }

    patterns.push({
      id: patternId,
      criterionId: row.criterion_id,
      title: summary.title,
      description: summary.description,
      failCount: row.fail_count,
      callCount: row.call_count,
      impactScore,
      severity: row.severity
    });
  }

  // Sort by impact score (highest first)
  patterns.sort((a, b) => b.impactScore - a.impactScore);

  console.log(`\n✅ Pattern detection complete`);
  console.log(`   Created/updated: ${patterns.length} patterns`);
  if (skippedLowImpact.length > 0) {
    console.log(`   Skipped (low impact): ${skippedLowImpact.join(', ')}`);
  }

  return {
    success: true,
    rubricId,
    agentVersionId: rubric.agent_version_id,
    agentId: rubric.agent_id,
    patterns,
    skippedLowImpact,
    thresholds: {
      minFailCount,
      minImpactScore
    }
  };
}

/**
 * Get patterns for an agent version
 *
 * @param {string} agentVersionId - Agent version UUID
 * @returns {Promise<Array>} List of patterns
 */
export async function getPatternsForAgentVersion(agentVersionId) {
  const result = await db.query(
    `SELECT
       p.id,
       p.rubric_id,
       p.criterion_id,
       p.title,
       p.description,
       p.fail_count,
       p.call_count,
       p.impact_score,
       p.representative_finding_ids,
       p.created_at,
       p.updated_at,
       rc.key as criterion_key,
       rc.severity
     FROM issue_patterns p
     JOIN rubric_criteria rc ON p.criterion_id = rc.id
     WHERE p.agent_version_id = $1 AND p.is_deleted = false
     ORDER BY p.impact_score DESC`,
    [agentVersionId]
  );

  return result.rows;
}

/**
 * Get patterns for an agent (using latest version)
 *
 * @param {string} agentId - Agent ID
 * @returns {Promise<Array>} List of patterns
 */
export async function getPatternsForAgent(agentId) {
  // Get latest version
  const versionResult = await db.query(
    `SELECT id FROM agent_versions
     WHERE agent_id = $1 AND is_deleted = false
     ORDER BY created_at DESC LIMIT 1`,
    [agentId]
  );

  if (versionResult.rows.length === 0) {
    return [];
  }

  return getPatternsForAgentVersion(versionResult.rows[0].id);
}

/**
 * Get pattern details with sample findings
 *
 * @param {string} patternId - Pattern UUID
 * @returns {Promise<Object>} Pattern details with findings
 */
export async function getPatternDetails(patternId) {
  // Get pattern
  const patternResult = await db.query(
    `SELECT
       p.*,
       rc.key as criterion_key,
       rc.description as criterion_description,
       rc.severity,
       rc.check_type
     FROM issue_patterns p
     JOIN rubric_criteria rc ON p.criterion_id = rc.id
     WHERE p.id = $1 AND p.is_deleted = false`,
    [patternId]
  );

  if (patternResult.rows.length === 0) {
    throw new Error(`Pattern ${patternId} not found`);
  }

  const pattern = patternResult.rows[0];

  // Get representative findings with call context
  const findingsResult = await db.query(
    `SELECT
       f.id,
       f.call_id,
       f.status,
       f.confidence,
       f.rationale,
       f.evidence_turn_ids,
       c.summary as call_summary,
       c.created_at_ghl as call_date,
       c.duration_s
     FROM findings f
     JOIN calls c ON f.call_id = c.id
     WHERE f.id = ANY($1) AND f.is_deleted = false
     ORDER BY f.created_at DESC
     LIMIT 10`,
    [pattern.representative_finding_ids]
  );

  return {
    ...pattern,
    sampleFindings: findingsResult.rows
  };
}

export default {
  detectPatterns,
  getPatternsForAgentVersion,
  getPatternsForAgent,
  getPatternDetails
};
