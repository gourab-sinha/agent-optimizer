/**
 * Recommendation Engine - Main Entry Point
 *
 * Architecture:
 *   assembleInput (rich context + readiness)
 *     → proposeRecommendations (diagnose → expand, with fallback)
 *     → validateAndInsert (shape, no-op, dedupe, coherence)
 *     → rankRecommendations (impact × confidence × risk × surgical preference)
 */

export { assembleInput } from './assembleInput.js';
export { proposeRecommendations, diagnoseStrategies, expandProposals } from './propose.js';
export { validateAndInsert } from './validate.js';
export { rankRecommendations, scoreRecommendation } from './rank.js';
export { normalizeProposal, normalizeProposals } from './normalize.js';
export * from './recTypes.js';

/**
 * Main workflow: Generate, validate, and rank recommendations
 *
 * @param {string} agentVersionId - Agent version UUID
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - Generate even if readiness.canGenerate is false
 * @param {boolean} [options.singleShot=false] - Skip two-phase propose
 * @param {number} [options.patternLimit=6]
 * @returns {Promise<Object>}
 */
export async function generateRecommendations(agentVersionId, options = {}) {
  const { force = false, singleShot = false, patternLimit = 6 } = options;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Generating Recommendations for Agent Version ${agentVersionId}`);
  console.log(`${'='.repeat(80)}`);

  // Step 1: Assemble
  const { assembleInput } = await import('./assembleInput.js');
  const input = await assembleInput(agentVersionId, { patternLimit });

  if (!input.readiness.canGenerate && !force) {
    console.log(`\n⛔ Generation blocked: ${input.readiness.reasons.join('; ')}`);
    return {
      accepted: [],
      rejected: [],
      blocked: true,
      readiness: input.readiness,
      agentVersionId,
      meta: {
        patternCount: input.patterns.length,
        testMode: input.readiness.mode,
        priorCount: input.priorRecommendations.length,
      },
    };
  }

  if (input.readiness.warnings?.length) {
    for (const w of input.readiness.warnings) {
      console.log(`   ⚠️  ${w}`);
    }
  }

  // Step 2: Propose (two-phase diagnose → expand)
  const { proposeRecommendations } = await import('./propose.js');
  const proposals = await proposeRecommendations(input, { singleShot });

  // Step 3: Validate + insert
  const { validateAndInsert } = await import('./validate.js');
  const result = await validateAndInsert(
    proposals,
    agentVersionId,
    input.agent,
    { patternsDetail: input.patterns }
  );

  // Step 4: Rank
  const { rankRecommendations } = await import('./rank.js');
  const ranked = rankRecommendations(result.accepted, input.patterns);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Recommendation Generation Complete`);
  console.log(`   Accepted: ${ranked.length}`);
  console.log(`   Rejected: ${result.rejected.length}`);
  if (ranked[0]) {
    console.log(
      `   Top: ${ranked[0].recType} (priority=${ranked[0].priorityScore})`
    );
  }
  console.log(`${'='.repeat(80)}\n`);

  return {
    accepted: ranked,
    rejected: result.rejected,
    blocked: false,
    readiness: input.readiness,
    agentVersionId,
    meta: {
      patternCount: input.patterns.length,
      proposalCount: proposals.length,
      testMode: input.readiness.mode,
      priorCount: input.priorRecommendations.length,
      topPriority: ranked[0]?.priorityScore ?? null,
    },
  };
}
