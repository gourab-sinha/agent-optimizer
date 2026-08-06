/**
 * Recommendation Script
 *
 * Usage: node scripts/recommend.js <agentId>
 *
 * Generates recommendations for the latest agent version:
 * 1. Loads patterns and test results
 * 2. Generates 2-6 recommendations via LLM
 * 3. Validates and inserts into database
 */

import dotenv from 'dotenv';
import db from '../src/db/connection.js';
import { generateRecommendations } from '../src/recommend/index.js';

dotenv.config();

async function main() {
  const agentId = process.argv[2];

  if (!agentId) {
    console.error('Usage: node scripts/recommend.js <agentId>');
    process.exit(1);
  }

  console.log('🎯 Recommendation Engine');
  console.log('='.repeat(80));
  console.log(`Agent ID: ${agentId}`);
  console.log('='.repeat(80));

  try {
    // Get latest agent version
    console.log('\n📍 Step 1: Getting latest agent version...');
    const versionResult = await db.query(
      `SELECT id, label, source
       FROM agent_versions
       WHERE agent_id = $1
         AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId]
    );

    if (versionResult.rows.length === 0) {
      throw new Error(`No agent versions found for agent ${agentId}`);
    }

    const agentVersion = versionResult.rows[0];
    console.log(`✓ Found version: ${agentVersion.id} (${agentVersion.label}, ${agentVersion.source})`);

    // Check for patterns
    console.log('\n📍 Step 2: Checking for patterns...');
    const patternsResult = await db.query(
      `SELECT COUNT(*) as count
       FROM issue_patterns
       WHERE agent_version_id = $1
         AND is_deleted = false`,
      [agentVersion.id]
    );

    const patternCount = parseInt(patternsResult.rows[0].count);
    console.log(`✓ Found ${patternCount} pattern(s)`);

    if (patternCount === 0) {
      console.warn('\n⚠️  No patterns found. Recommendations may be limited.');
      console.warn('   Run pattern detection first: POST /api/patterns/detect');
    }

    // Check for test results
    console.log('\n📍 Step 3: Checking for test results...');
    const testRunResult = await db.query(
      `SELECT id, status
       FROM test_runs
       WHERE agent_version_id = $1
         AND status = 'completed'
         AND is_deleted = false
       ORDER BY finished_at DESC
       LIMIT 1`,
      [agentVersion.id]
    );

    if (testRunResult.rows.length > 0) {
      const testRun = testRunResult.rows[0];

      // Get test statistics from test_results
      const statsResult = await db.query(
        `SELECT
           COUNT(DISTINCT test_case_id) as total_tests,
           COUNT(DISTINCT CASE WHEN passed = true THEN test_case_id END) as passed_tests,
           COUNT(DISTINCT CASE WHEN passed = false THEN test_case_id END) as failed_tests
         FROM test_results
         WHERE test_run_id = $1
           AND is_deleted = false`,
        [testRun.id]
      );

      const stats = statsResult.rows[0];
      console.log(`✓ Found test run: ${testRun.id}`);
      console.log(`   Tests: ${stats.total_tests}, Passed: ${stats.passed_tests}, Failed: ${stats.failed_tests}`);
    } else {
      console.warn('⚠️  No completed test runs found');
      console.warn('   Test results provide valuable context for recommendations');
    }

    // Generate recommendations
    console.log('\n📍 Step 4: Generating recommendations...');
    const result = await generateRecommendations(agentVersion.id);

    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('📋 ACCEPTED RECOMMENDATIONS');
    console.log('='.repeat(80));

    if (result.accepted.length === 0) {
      console.log('\nNo recommendations were accepted.');
    } else {
      for (let i = 0; i < result.accepted.length; i++) {
        const rec = result.accepted[i];
        console.log(`\n${i + 1}. ${rec.recType} (${rec.tier})`);
        console.log(`   Rationale: ${rec.rationale}`);
        console.log(`   Linked patterns: ${rec.linkedPatternIds.length}`);
        console.log(`   Expected improvements: ${rec.expectedCriterionIds.length} criteria`);
      }
    }

    if (result.rejected.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('❌ REJECTED RECOMMENDATIONS');
      console.log('='.repeat(80));

      for (let i = 0; i < result.rejected.length; i++) {
        const rej = result.rejected[i];
        console.log(`\n${i + 1}. ${rej.proposal.recType}`);
        console.log(`   Reason: ${rej.reason}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ RECOMMENDATION GENERATION COMPLETE');
    console.log('='.repeat(80));

    console.log('\n💡 Next Steps:');
    console.log('   Review the recommendations above and decide which ones to implement.');
    console.log('   The recommendations are stored in the database with status: proposed');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
