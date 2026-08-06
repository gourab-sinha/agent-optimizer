import dotenv from 'dotenv';
import testRunnerService from '../src/services/testRunnerService.js';
import testGenerationService from '../src/services/testGenerationService.js';

dotenv.config();

const AGENT_ID = '6a730523fa14242d523f6004'; // Maya

async function testRunner() {
  console.log('🧪 Testing Test Runner Service');
  console.log('═'.repeat(80));
  console.log(`Agent ID: ${AGENT_ID}`);
  console.log('═'.repeat(80));

  try {
    // Step 1: Get existing test cases
    console.log('\n📝 Step 1: Getting test cases...');
    const testCases = await testGenerationService.getTestCases(AGENT_ID);

    if (testCases.length === 0) {
      console.log('❌ No test cases found. Run test generation first:');
      console.log('   npm run test:generate');
      process.exit(1);
    }

    console.log(`✓ Found ${testCases.length} test cases`);

    const happyPathCases = testCases.filter(t => t.kind === 'happy_path');
    const edgeCases = testCases.filter(t => t.kind === 'edge_case');

    console.log(`   Happy Path: ${happyPathCases.length}`);
    console.log(`   Edge Cases: ${edgeCases.length}`);

    // Step 2: Run tests
    console.log('\n🚀 Step 2: Running tests...');
    console.log('   This will simulate conversations and evaluate the agent');
    console.log('   Each test case will run once');

    const result = await testRunnerService.runTests(AGENT_ID, {
      runsPerCase: 1,  // Run each test once
      trigger: 'manual'
    });

    console.log(`\n✅ Test Run Complete!`);
    console.log('═'.repeat(80));
    console.log(`   Test Run ID: ${result.testRunId}`);
    console.log(`   Agent: ${result.agentName}`);
    console.log(`   Total Tests: ${result.totalTests}`);
    console.log(`   Passed: ${result.totalPassed}`);
    console.log(`   Failed: ${result.totalFailed}`);
    console.log(`   Pass Rate: ${result.passRate}%`);
    console.log('═'.repeat(80));

    // Step 3: Display results by test case
    console.log('\n📊 Test Results by Test Case:');
    console.log('═'.repeat(80));

    const groupedResults = {};
    for (const res of result.results) {
      if (!groupedResults[res.testCaseTitle]) {
        groupedResults[res.testCaseTitle] = [];
      }
      groupedResults[res.testCaseTitle].push(res);
    }

    for (const [title, attempts] of Object.entries(groupedResults)) {
      const passCount = attempts.filter(a => a.passed).length;
      const totalCount = attempts.length;
      const passRate = ((passCount / totalCount) * 100).toFixed(0);

      console.log(`\n${title}`);
      console.log('─'.repeat(80));
      console.log(`   Results: ${passCount}/${totalCount} passed (${passRate}%)`);

      // Show first attempt details
      const firstAttempt = attempts[0];
      console.log(`\n   Criterion Evaluations (Attempt 1):`);

      for (const [criterionId, outcome] of Object.entries(firstAttempt.criterionOutcomes || {})) {
        const statusIcon = outcome.status === 'pass' ? '✓' : '✗';
        const statusColor = outcome.status === 'pass' ? '' : '';
        console.log(`   ${statusIcon} ${outcome.status.toUpperCase()} (${(outcome.confidence * 100).toFixed(0)}% confidence)`);
        console.log(`      ${outcome.rationale}`);
      }

      // Show sample conversation (first 4 turns)
      if (firstAttempt.conversation && firstAttempt.conversation.length > 0) {
        console.log(`\n   Sample Conversation (first 4 turns):`);
        firstAttempt.conversation.slice(0, 4).forEach((turn, i) => {
          const speaker = turn.speaker === 'agent' ? 'AGENT' : 'CALLER';
          console.log(`   ${i + 1}. ${speaker}: ${turn.text.substring(0, 100)}${turn.text.length > 100 ? '...' : ''}`);
        });
      }
    }

    // Step 4: Get test run from database
    console.log('\n\n📝 Step 3: Retrieving test run from database...');
    const testRun = await testRunnerService.getTestRun(result.testRunId);
    const dbResults = await testRunnerService.getTestResults(result.testRunId);

    console.log(`✓ Test run retrieved: ${testRun.id}`);
    console.log(`   Status: ${testRun.status}`);
    console.log(`   Started: ${new Date(testRun.started_at).toLocaleString()}`);
    console.log(`   Finished: ${new Date(testRun.finished_at).toLocaleString()}`);
    console.log(`   Results in DB: ${dbResults.length}`);

    // Step 5: Get all test runs for agent
    console.log('\n📝 Step 4: Getting test run history...');
    const allRuns = await testRunnerService.getTestRunsForAgent(AGENT_ID);

    console.log(`✓ Found ${allRuns.length} test runs for this agent`);

    if (allRuns.length > 0) {
      console.log('\n   Recent Test Runs:');
      allRuns.slice(0, 3).forEach((run, i) => {
        const passRate = run.total_tests > 0
          ? ((run.passed_tests / run.total_tests) * 100).toFixed(1)
          : 0;
        console.log(`   ${i + 1}. ${new Date(run.created_at).toLocaleString()}`);
        console.log(`      Tests: ${run.total_tests}, Pass Rate: ${passRate}%`);
        console.log(`      Status: ${run.status}, Trigger: ${run.trigger}`);
      });
    }

    console.log('\n═'.repeat(80));
    console.log('✅ Test Runner Test Complete!');
    console.log('═'.repeat(80));

    console.log('\n📈 Summary:');
    console.log(`   Test Run ID: ${result.testRunId}`);
    console.log(`   Total Tests Executed: ${result.totalTests}`);
    console.log(`   Overall Pass Rate: ${result.passRate}%`);

    console.log('\n💡 Next Steps:');
    console.log('   1. Review test results in database');
    console.log('   2. Analyze failed tests to identify issues');
    console.log('   3. View results in UI (coming soon)');
    console.log('   4. Re-run tests after making improvements');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the test
testRunner();
