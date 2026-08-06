/**
 * Rank accepted recommendations by expected impact and surgical preference
 */

import { getDefaultRisk, getPreferenceRank } from './recTypes.js';

const RISK_WEIGHT = { low: 1, medium: 0.75, high: 0.5 };

/**
 * Build pattern impact lookup from assembled input
 */
function patternImpactMap(patterns = []) {
  const map = new Map();
  for (const p of patterns) {
    map.set(p.id, Number(p.impactScore) || 0);
  }
  return map;
}

/**
 * Score a single recommendation
 */
export function scoreRecommendation(rec, patterns = []) {
  const impacts = patternImpactMap(patterns);
  const linked = rec.linkedPatternIds || rec.linked_pattern_ids || [];
  const maxImpact =
    linked.length > 0
      ? Math.max(...linked.map((id) => impacts.get(id) ?? 0.1))
      : 0.1;

  const confidence =
    typeof rec.confidence === 'number' ? rec.confidence : 0.5;
  const risk = rec.risk || getDefaultRisk(rec.recType || rec.rec_type);
  const riskMul = RISK_WEIGHT[risk] ?? 0.75;
  const pref = getPreferenceRank(rec.recType || rec.rec_type);
  // Prefer surgical types slightly
  const surgicalBonus = Math.max(0, (12 - pref) / 12) * 0.15;

  const score = maxImpact * confidence * riskMul + surgicalBonus;

  return {
    ...rec,
    risk,
    confidence,
    priorityScore: Number(score.toFixed(4)),
    maxLinkedImpact: maxImpact,
  };
}

/**
 * Rank recommendations descending by priorityScore
 */
export function rankRecommendations(accepted = [], patterns = []) {
  return accepted
    .map((r) => scoreRecommendation(r, patterns))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}
