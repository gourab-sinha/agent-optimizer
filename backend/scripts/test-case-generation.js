import dotenv from 'dotenv';
import testGenerationService from '../src/services/testGenerationService.js';

dotenv.config();

const AGENT_ID = '6a730523fa14242d523f6004'; // Maya

async function testCaseGeneration() {
  console.log('🧪 Testing Test Case Generation');
  console.log('═'.repeat(80));
  console.log(`Agent ID: ${AGENT_ID}`);
  console.log('═'.repeat(80));

  try {
    // Step 1: Generate test cases
    console.log('\n📝 Step 1: Generating test cases...');
    console.log('   This will use the agent\'s actual prompt and past call patterns');

    const result = await testGenerationService.generateTestCases(AGENT_ID, {
      happyPathCount: 2,   // Generate 2 happy path cases
      edgeCaseCount: 1     // Generate 1 edge case per pattern
    });

    console.log(`\n✅ Test Generation Complete!`);
    console.log(`   Agent: ${result.agentName}`);
    console.log(`   Happy Path Cases: ${result.happyPathCases.length}`);
    console.log(`   Edge Cases: ${result.edgeCases.length}`);
    console.log(`   Total: ${result.totalCases} test cases`);

    // Step 2: Display happy path cases
    if (result.happyPathCases.length > 0) {
      console.log('\n📊 Happy Path Test Cases:');
      console.log('═'.repeat(80));

      result.happyPathCases.forEach((testCase, i) => {
        console.log(`\n${i + 1}. ${testCase.title}`);
        console.log('─'.repeat(80));
        console.log(`   Persona: ${testCase.persona.name} (${testCase.persona.communication_style})`);
        console.log(`   Needs: ${testCase.persona.needs}`);
        console.log(`   Scenario: ${testCase.scenario.substring(0, 150)}...`);
        console.log(`   Tests Criteria: ${testCase.criterion_keys?.join(', ')}`);
      });
    }

    // Step 3: Display edge cases
    if (result.edgeCases.length > 0) {
      console.log('\n\n⚠️  Edge Case Test Cases:');
      console.log('═'.repeat(80));

      result.edgeCases.forEach((testCase, i) => {
        console.log(`\n${i + 1}. ${testCase.title}`);
        console.log('─'.repeat(80));
        console.log(`   Pattern: ${testCase.pattern}`);
        console.log(`   Persona: ${testCase.persona.name} (${testCase.persona.communication_style})`);
        console.log(`   Challenge: ${testCase.persona.challenge}`);
        console.log(`   Scenario: ${testCase.scenario.substring(0, 150)}...`);
        console.log(`   Tests Criteria: ${testCase.criterion_keys?.join(', ')}`);
      });
    }

    // Step 4: Get all test cases from database
    console.log('\n\n📝 Step 2: Retrieving all test cases from database...');
    const allTests = await testGenerationService.getTestCases(AGENT_ID);

    console.log(`✓ Found ${allTests.length} total test cases in database`);

    const happyPathCount = allTests.filter(t => t.kind === 'happy_path').length;
    const edgeCaseCount = allTests.filter(t => t.kind === 'edge_case').length;

    console.log(`   Happy Path: ${happyPathCount}`);
    console.log(`   Edge Cases: ${edgeCaseCount}`);

    // Step 5: Get details of first test case
    if (allTests.length > 0) {
      console.log('\n📝 Step 3: Getting test case details...');
      const firstTest = allTests[0];
      const details = await testGenerationService.getTestCaseDetails(firstTest.id);

      console.log(`\n📋 Test Case: ${details.title}`);
      console.log('─'.repeat(80));
      console.log(`   ID: ${details.id}`);
      console.log(`   Kind: ${details.kind}`);
      console.log(`   Persona: ${JSON.stringify(details.persona, null, 2)}`);
      console.log(`   Scenario: ${details.scenario.substring(0, 200)}...`);
      console.log(`   Criteria Count: ${details.criterion_ids?.length || 0}`);
      if (details.pattern_title) {
        console.log(`   Based on Pattern: ${details.pattern_title}`);
      }
    }

    console.log('\n═'.repeat(80));
    console.log('✅ Test Case Generation Test Complete!');
    console.log('═'.repeat(80));

    console.log('\n📈 Summary:');
    console.log(`   Total Test Cases: ${allTests.length}`);
    console.log(`   Happy Path: ${happyPathCount} cases`);
    console.log(`   Edge Cases: ${edgeCaseCount} cases`);

    if (allTests.length > 0) {
      console.log('\n💡 Next Steps:');
      console.log('   1. Review generated test cases in database');
      console.log('   2. Run tests against agent (coming soon)');
      console.log('   3. View results in UI (coming soon)');
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
testCaseGeneration();
