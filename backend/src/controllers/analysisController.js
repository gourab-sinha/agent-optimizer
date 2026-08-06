/**
 * Analysis Controller
 * Handles rubric generation, call evaluation, and findings retrieval
 */

import {
  generateRubricForAgentVersion,
  evaluateCall,
  getRubricByAgentVersion,
} from '../services/rubricEvaluationService.js';
import db from '../db/connection.js';

/**
 * POST /api/analysis/rubric/generate
 * Generate rubric for an agent version
 *
 * Body: { agentVersionId: UUID }
 * Response: { success: true, rubricId: UUID, criteriaCount: number, cached: boolean }
 */
export async function generateRubric(req, res) {
  try {
    const { agentVersionId } = req.body;

    if (!agentVersionId) {
      return res.status(400).json({
        success: false,
        error: 'agentVersionId is required',
      });
    }

    const result = await generateRubricForAgentVersion(agentVersionId);

    res.json({
      success: true,
      rubricId: result.rubricId,
      criteriaCount: result.criteriaCount,
      cached: result.cached || false,
    });
  } catch (error) {
    console.error('[Analysis Controller] Generate rubric error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/analysis/rubric/:agentVersionId
 * Get rubric for an agent version
 *
 * Response: { success: true, rubric: {...} }
 */
export async function getRubric(req, res) {
  try {
    const { agentVersionId } = req.params;

    if (!agentVersionId) {
      return res.status(400).json({
        success: false,
        error: 'agentVersionId is required',
      });
    }

    const rubric = await getRubricByAgentVersion(agentVersionId);

    if (!rubric) {
      return res.status(404).json({
        success: false,
        error: 'Rubric not found for this agent version',
      });
    }

    res.json({
      success: true,
      rubric,
    });
  } catch (error) {
    console.error('[Analysis Controller] Get rubric error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/analysis/evaluate
 * Evaluate calls against a rubric
 *
 * Body: { rubricId: UUID, callIds: [string] }
 * Response: { success: true, results: [{callId, findingsCreated}] }
 */
export async function evaluateCalls(req, res) {
  try {
    const { rubricId, callIds } = req.body;

    if (!rubricId) {
      return res.status(400).json({
        success: false,
        error: 'rubricId is required',
      });
    }

    if (!Array.isArray(callIds) || callIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'callIds must be a non-empty array',
      });
    }

    const results = [];

    for (const callId of callIds) {
      try {
        const result = await evaluateCall(callId, rubricId);
        results.push({
          callId,
          findingsCreated: result.findingsCreated,
          success: true,
        });
      } catch (error) {
        console.error(`[Analysis Controller] Failed to evaluate call ${callId}:`, error);
        results.push({
          callId,
          success: false,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('[Analysis Controller] Evaluate calls error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/analysis/findings/:callId
 * Get findings for a call
 *
 * Query params:
 *   - rubricId (optional): Filter by specific rubric
 *   - status (optional): Filter by status (pass/fail/partial/missed_opportunity/na)
 *
 * Response: { success: true, findings: [...] }
 */
export async function getFindings(req, res) {
  try {
    const { callId } = req.params;
    const { rubricId, status } = req.query;

    if (!callId) {
      return res.status(400).json({
        success: false,
        error: 'callId is required',
      });
    }

    let query = `
      SELECT
        f.id,
        f.call_id,
        f.rubric_id,
        f.criterion_id,
        f.status,
        f.confidence,
        f.rationale,
        f.evidence_turn_ids,
        f.method,
        f.created_at,
        rc.key as criterion_key,
        rc.category,
        rc.description,
        rc.check_type,
        rc.severity
      FROM findings f
      JOIN rubric_criteria rc ON f.criterion_id = rc.id
      WHERE f.call_id = $1 AND f.is_deleted = false
    `;

    const params = [callId];

    if (rubricId) {
      params.push(rubricId);
      query += ` AND f.rubric_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND f.status = $${params.length}`;
    }

    query += ` ORDER BY rc.severity DESC, rc.category, rc.key`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      findings: result.rows,
    });
  } catch (error) {
    console.error('[Analysis Controller] Get findings error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

export default {
  generateRubric,
  getRubric,
  evaluateCalls,
  getFindings,
};
