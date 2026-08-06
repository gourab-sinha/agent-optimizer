import dotenv from 'dotenv';
import db from '../src/db/connection.js';
import patternDetectionService from '../src/services/patternDetectionService.js';

dotenv.config();

const AGENT_ID = '6a730523fa14242d523f6004'; // Maya

async function testPatternDetection() {
  console.log('🧪 Testing Pattern Detection Service');
  console.log('═'.repeat(80));
  console.log(`Agent ID: ${AGENT_ID}`);
  console.log('═'.repeat(80));

  try {
    // Step 1: Get agent's latest rubric
    console.log('\n📝 Step 1: Finding rubric...');
    const rubricResult = await db.query(
      `SELECT r.id, r.agent_version_id, av.agent_id
       FROM rubrics r
       JOIN agent_versions av ON r.agent_version_id = av.id
       WHERE av.agent_id = $1 AND r.is_deleted = false
       ORDER BY r.created_at DESC LIMIT 1`,
      [AGENT_ID]
    );

    if (rubricResult.rows.length === 0) {
      throw new Error(`No rubric found for agent ${AGENT_ID}. Run test-analysis-real.js first to generate rubric.`);
    }

    const rubric = rubricResult.rows[0];
    console.log(`✓ Rubric found: ${rubric.id}`);
    console.log(`  Agent version: ${rubric.agent_version_id}`);

    // Step 2: Check findings
    console.log('\n📝 Step 2: Checking findings...');
    const findingsResult = await db.query(
      `SELECT
         COUNT(*) as total_findings,
         COUNT(DISTINCT call_id) as calls_evaluated,
         COUNT(*) FILTER (WHERE status = 'fail') as failures,
         COUNT(*) FILTER (WHERE status = 'pass') as passes
       FROM findings
       WHERE rubric_id = $1 AND is_deleted = false`,
      [rubric.id]
    );

    const stats = findingsResult.rows[0];
    console.log(`✓ Findings:`);
    console.log(`  Total: ${stats.total_findings}`);
    console.log(`  Calls evaluated: ${stats.calls_evaluated}`);
    console.log(`  Failures: ${stats.failures}`);
    console.log(`  Passes: ${stats.passes}`);

    if (parseInt(stats.total_findings) === 0) {
      throw new Error('No findings found. Run test-analysis-real.js to evaluate calls first.');
    }

    // Step 3: Detect patterns
    console.log('\n📝 Step 3: Detecting patterns...');
    const patternResult = await patternDetectionService.detectPatterns(rubric.id, {
      minFailCount: 1,  // Lower threshold for testing
      minImpactScore: 0.1
    });

    console.log(`\n✅ Detection Results`);
    console.log(`   Patterns found: ${patternResult.patterns.length}`);

    if (patternResult.skippedLowImpact.length > 0) {
      console.log(`   Skipped (low impact): ${patternResult.skippedLowImpact.length}`);
    }

    // Step 4: Display patterns
    if (patternResult.patterns.length > 0) {
      console.log('\n📊 Detected Patterns:');
      console.log('═'.repeat(80));

      patternResult.patterns.forEach((pattern, i) => {
        const failRate = ((pattern.failCount / pattern.callCount) * 100).toFixed(1);

        console.log(`\n${i + 1}. ${pattern.title}`);
        console.log('─'.repeat(80));
        console.log(`   Impact Score: ${pattern.impactScore.toFixed(2)}/3`);
        console.log(`   Severity: ${'🔴'.repeat(pattern.severity)}${'⚪'.repeat(3 - pattern.severity)} (${pattern.severity}/3)`);
        console.log(`   Failure Rate: ${failRate}% (${pattern.failCount}/${pattern.callCount} calls)`);
        console.log(`   Description: ${pattern.description}`);
      });
    } else {
      console.log('\n⚠️  No patterns detected with current thresholds');
      console.log('   Try evaluating more calls or lowering minImpactScore');
    }

    // Step 5: Test get patterns for agent
    console.log('\n📝 Step 4: Testing getPatternsForAgent...');
    const agentPatterns = await patternDetectionService.getPatternsForAgent(AGENT_ID);
    console.log(`✓ Retrieved ${agentPatterns.length} patterns for agent ${AGENT_ID}`);

    // Step 6: Get details for first pattern
    if (agentPatterns.length > 0) {
      console.log('\n📝 Step 5: Getting pattern details...');
      const firstPattern = agentPatterns[0];
      const details = await patternDetectionService.getPatternDetails(firstPattern.id);

      console.log(`\n🔍 Pattern Details: ${details.title}`);
      console.log('─'.repeat(80));
      console.log(`   Criterion: ${details.criterion_name}`);
      console.log(`   Check Type: ${details.check_type}`);
      console.log(`   Sample Findings: ${details.sampleFindings.length}`);

      if (details.sampleFindings.length > 0) {
        console.log('\n   Example Failures:');
        details.sampleFindings.slice(0, 3).forEach((f, i) => {
          console.log(`   ${i + 1}. ${f.rationale}`);
          console.log(`      Call: ${f.call_summary?.substring(0, 60)}...`);
          console.log(`      Confidence: ${(f.confidence * 100).toFixed(0)}%`);
        });
      }
    }

    console.log('\n═'.repeat(80));
    console.log('✅ Pattern Detection Test Complete!');
    console.log('═'.repeat(80));

    // Summary
    console.log('\n📈 Summary:');
    console.log(`   Rubric ID: ${rubric.id}`);
    console.log(`   Calls Evaluated: ${stats.calls_evaluated}`);
    console.log(`   Total Findings: ${stats.total_findings}`);
    console.log(`   Patterns Detected: ${patternResult.patterns.length}`);

    if (patternResult.patterns.length > 0) {
      const topPattern = patternResult.patterns[0];
      console.log(`\n   🏆 Top Issue: ${topPattern.title}`);
      console.log(`      Impact: ${topPattern.impactScore.toFixed(2)}/3`);
      console.log(`      Affects: ${topPattern.failCount}/${topPattern.callCount} calls`);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the test
testPatternDetection();
