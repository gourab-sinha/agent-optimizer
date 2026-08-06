/**
 * Recommendation Engine - Main Entry Point
 *
 * Exports recommendation engine functions:
 * - assemble: Gather input context
 * - propose: LLM-based recommendation generation
 * - validate: Deterministic validation
 */

export { assembleInput } from './assembleInput.js';
export { proposeRecommendations } from './propose.js';
export { validateAndInsert } from './validate.js';
export * from './recTypes.js';

/**
 * Main workflow: Generate and validate recommendations
 *
 * @param {string} agentVersionId - Agent version UUID
 * @returns {Promise<Object>} Result with accepted/rejected recommendations
 */
export async function generateRecommendations(agentVersionId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Generating Recommendations for Agent Version ${agentVersionId}`);
  console.log(`${'='.repeat(80)}`);

  // Step 1: Assemble input
  const { assembleInput } = await import('./assembleInput.js');
  const input = await assembleInput(agentVersionId);

  // Step 2: Propose via LLM
  const { proposeRecommendations } = await import('./propose.js');
  const proposals = await proposeRecommendations(input);

  // Step 3: Validate and insert
  const { validateAndInsert } = await import('./validate.js');
  const result = await validateAndInsert(proposals, agentVersionId, input.agent);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Recommendation Generation Complete`);
  console.log(`   Accepted: ${result.accepted.length}`);
  console.log(`   Rejected: ${result.rejected.length}`);
  console.log(`${'='.repeat(80)}\n`);

  return result;
}
