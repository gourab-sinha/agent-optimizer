/**
 * Recommendations API Routes
 */

import express from 'express';
import db from '../db/connection.js';
import { generateRecommendations } from '../recommend/index.js';

const router = express.Router();

/**
 * GET /api/recommendations/agent/:agentId
 * Get all recommendations for an agent (latest version)
 */
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { status } = req.query; // Optional filter by status

    // Get latest agent version
    const versionResult = await db.query(
      `SELECT id FROM agent_versions
       WHERE agent_id = $1
         AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No agent versions found'
      });
    }

    const versionId = versionResult.rows[0].id;

    // Build query
    let query = `
      SELECT
        r.id,
        r.rec_type,
        r.tier,
        r.payload,
        r.rationale,
        r.status,
        r.linked_pattern_ids,
        r.expected_criterion_ids,
        r.supporting_test_case_ids,
        r.created_at,
        r.updated_at
      FROM recommendations r
      WHERE r.agent_version_id = $1
        AND r.is_deleted = false
    `;

    const params = [versionId];

    if (status) {
      query += ` AND r.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await db.query(query, params);

    // Get pattern details for each recommendation
    const recommendations = await Promise.all(
      result.rows.map(async (rec) => {
        // Get linked patterns with criterion key
        const patterns = await db.query(
          `SELECT
             p.id,
             p.title,
             c.key as criterion_key
           FROM issue_patterns p
           LEFT JOIN rubric_criteria c ON p.criterion_id = c.id
           WHERE p.id = ANY($1)
             AND p.is_deleted = false`,
          [rec.linked_pattern_ids || []]
        );

        // Get expected criteria
        const criteria = await db.query(
          `SELECT id, key, description
           FROM rubric_criteria
           WHERE id = ANY($1)
             AND is_deleted = false`,
          [rec.expected_criterion_ids || []]
        );

        return {
          id: rec.id,
          recType: rec.rec_type,
          tier: rec.tier,
          payload: rec.payload,
          rationale: rec.rationale,
          status: rec.status,
          linkedPatterns: patterns.rows,
          expectedCriteria: criteria.rows,
          supportingTestCaseIds: rec.supporting_test_case_ids || [],
          createdAt: rec.created_at,
          updatedAt: rec.updated_at
        };
      })
    );

    res.json({
      success: true,
      recommendations,
      agentVersionId: versionId
    });

  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/recommendations/generate/:agentId
 * Generate new recommendations for an agent
 */
router.post('/generate/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    // Get latest agent version
    const versionResult = await db.query(
      `SELECT id FROM agent_versions
       WHERE agent_id = $1
         AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No agent versions found'
      });
    }

    const versionId = versionResult.rows[0].id;

    // Generate recommendations
    const result = await generateRecommendations(versionId);

    res.json({
      success: true,
      accepted: result.accepted.length,
      rejected: result.rejected.length,
      recommendations: result.accepted,
      agentVersionId: versionId
    });

  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/recommendations/:recommendationId
 * Delete (soft delete) a recommendation
 */
router.delete('/:recommendationId', async (req, res) => {
  try {
    const { recommendationId } = req.params;

    await db.query(
      `UPDATE recommendations
       SET is_deleted = true, updated_at = now()
       WHERE id = $1`,
      [recommendationId]
    );

    res.json({
      success: true,
      message: 'Recommendation deleted'
    });

  } catch (error) {
    console.error('Error deleting recommendation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
