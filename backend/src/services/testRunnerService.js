import db from '../db/connection.js';
import { callLLM } from './llmService.js';

/**
 * Test Runner Service
 * Runs generated test cases against agent configurations
 * Simulates conversations and evaluates against success criteria
 */

/**
 * Run test cases for an agent
 * @param {string} agentId - Agent ID
 * @param {Object} options - Run options
 * @param {string[]} options.testCaseIds - Specific test case IDs to run (optional, runs all if not provided)
 * @param {number} options.runsPerCase - Number of times to run each test case (default: 1)
 * @param {string} options.trigger - Trigger type: 'manual', 'verify_before', 'verify_after'
 * @returns {Promise<Object>} Test run results
 */
export async function runTests(agentId, options = {}) {
  const {
    testCaseIds = null,
    runsPerCase = 1,
    trigger = 'manual'
  } = options;

  console.log(`\n🧪 Running tests for agent ${agentId}`);
  console.log(`   Runs per case: ${runsPerCase}, Trigger: ${trigger}`);

  // Get agent details with latest version
  const agentResult = await db.query(
    `SELECT a.id, a.name, a.location_id, a.config,
            av.id as version_id, av.config as version_config
     FROM agents a
     JOIN agent_versions av ON a.id = av.agent_id
     WHERE a.id = $1 AND a.is_deleted = false AND av.is_deleted = false
     ORDER BY av.created_at DESC
     LIMIT 1`,
    [agentId]
  );

  if (agentResult.rows.length === 0) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const agent = agentResult.rows[0];
  const agentPrompt = agent.config?.agentPrompt || agent.version_config?.agentPrompt;

  if (!agentPrompt) {
    throw new Error(`Agent ${agentId} has no prompt configured`);
  }

  console.log(`   ✓ Agent: ${agent.name}`);
  console.log(`   ✓ Version: ${agent.version_id}`);

  // Get rubric for evaluation
  const rubricResult = await db.query(
    `SELECT id FROM rubrics
     WHERE agent_version_id = $1 AND is_deleted = false
     ORDER BY created_at DESC LIMIT 1`,
    [agent.version_id]
  );

  if (rubricResult.rows.length === 0) {
    throw new Error(`No rubric found for agent ${agentId}. Generate a rubric first.`);
  }

  const rubricId = rubricResult.rows[0].id;

  // Get rubric criteria
  const criteriaResult = await db.query(
    `SELECT id, key, description, severity, category, check_type
     FROM rubric_criteria
     WHERE rubric_id = $1 AND is_deleted = false AND enabled = true
     ORDER BY severity DESC, category`,
    [rubricId]
  );

  const criteria = criteriaResult.rows;
  console.log(`   ✓ Found ${criteria.length} rubric criteria`);

  // Get test cases to run (with pattern info for edge cases)
  let testCasesQuery = `
    SELECT
      tc.id, tc.kind, tc.title, tc.persona, tc.scenario, tc.criterion_ids,
      tc.seeded_by_pattern_id,
      ip.description as pattern_description,
      ip.fail_count,
      ip.impact_score
    FROM test_cases tc
    LEFT JOIN issue_patterns ip ON tc.seeded_by_pattern_id = ip.id
    WHERE tc.agent_id = $1 AND tc.is_deleted = false AND tc.archived = false
  `;
  const queryParams = [agentId];

  if (testCaseIds && testCaseIds.length > 0) {
    testCasesQuery += ` AND tc.id = ANY($2)`;
    queryParams.push(testCaseIds);
  }

  testCasesQuery += ` ORDER BY tc.kind, tc.created_at`;

  const testCasesResult = await db.query(testCasesQuery, queryParams);
  const testCases = testCasesResult.rows;

  if (testCases.length === 0) {
    throw new Error('No test cases found to run');
  }

  console.log(`   ✓ Found ${testCases.length} test cases to run`);

  // Create test run
  const testRunResult = await db.query(
    `INSERT INTO test_runs (
       agent_version_id,
       rubric_id,
       trigger,
       runs_per_case,
       status,
       started_at
     ) VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id`,
    [agent.version_id, rubricId, trigger, runsPerCase, 'running']
  );

  const testRunId = testRunResult.rows[0].id;
  console.log(`   ✓ Created test run: ${testRunId}`);

  // Run each test case
  const results = [];
  let totalTests = 0;
  let totalPassed = 0;

  for (const testCase of testCases) {
    console.log(`\n   → Testing: ${testCase.title}`);

    for (let attempt = 1; attempt <= runsPerCase; attempt++) {
      console.log(`      Attempt ${attempt}/${runsPerCase}...`);

      try {
        const result = await runSingleTest(
          agent,
          agentPrompt,
          testCase,
          criteria,
          testRunId,
          attempt
        );

        results.push(result);
        totalTests++;
        if (result.passed) totalPassed++;

        console.log(`      ${result.passed ? '✓ PASS' : '✗ FAIL'}`);

      } catch (error) {
        console.error(`      ✗ Error: ${error.message}`);
        // Store failed result
        await db.query(
          `INSERT INTO test_results (
             test_run_id, test_case_id, attempt, call_id,
             passed, criterion_outcomes
           ) VALUES ($1, $2, $3, NULL, false, $4)`,
          [testRunId, testCase.id, attempt, JSON.stringify({ error: error.message })]
        );
        totalTests++;
      }
    }
  }

  // Update test run status
  await db.query(
    `UPDATE test_runs
     SET status = 'completed', finished_at = now()
     WHERE id = $1`,
    [testRunId]
  );

  const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0;

  console.log(`\n✅ Test run complete`);
  console.log(`   Total tests: ${totalTests}`);
  console.log(`   Passed: ${totalPassed}`);
  console.log(`   Failed: ${totalTests - totalPassed}`);
  console.log(`   Pass rate: ${passRate}%`);

  return {
    success: true,
    testRunId,
    agentId,
    agentName: agent.name,
    totalTests,
    totalPassed,
    totalFailed: totalTests - totalPassed,
    passRate: parseFloat(passRate),
    results
  };
}

/**
 * Run a single test case attempt
 * Simulates conversation and evaluates against criteria
 */
async function runSingleTest(agent, agentPrompt, testCase, criteria, testRunId, attempt) {
  // Parse persona
  const persona = typeof testCase.persona === 'string'
    ? JSON.parse(testCase.persona)
    : testCase.persona;

  // Get relevant criteria for this test case
  const testCriteria = criteria.filter(c => testCase.criterion_ids?.includes(c.id));

  // For edge cases, provide the criteria as "expected failures" to simulation
  // Also include pattern context if available
  const expectedFailures = testCase.kind === 'edge_case' ? testCriteria.map(c => ({
    ...c,
    pattern_description: testCase.pattern_description,
    fail_count: testCase.fail_count,
    impact_score: testCase.impact_score
  })) : [];

  // Simulate conversation
  const conversation = await simulateConversation(
    agentPrompt,
    persona,
    testCase.scenario,
    testCase.kind,
    expectedFailures
  );

  // Evaluate conversation against each criterion
  const criterionOutcomes = {};
  let allPassed = true;

  for (const criterion of testCriteria) {
    const outcome = await evaluateCriterion(
      conversation,
      criterion,
      agentPrompt
    );

    criterionOutcomes[criterion.id] = outcome;

    if (outcome.status === 'fail') {
      allPassed = false;
    }
  }

  // Store result (call_id is NULL for simulated tests)
  await db.query(
    `INSERT INTO test_results (
       test_run_id, test_case_id, attempt, call_id,
       passed, criterion_outcomes
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [testRunId, testCase.id, attempt, null, allPassed, JSON.stringify(criterionOutcomes)]
  );

  return {
    testCaseId: testCase.id,
    testCaseTitle: testCase.title,
    attempt,
    passed: allPassed,
    conversation,
    criterionOutcomes
  };
}

/**
 * Simulate a conversation between caller (persona) and agent
 * Uses LLM to generate realistic dialogue
 * IMPORTANT: For edge cases, simulates agent struggling with known weaknesses
 */
async function simulateConversation(agentPrompt, persona, scenario, testCaseKind = 'happy_path', expectedFailures = []) {
  // Build context about agent weaknesses for edge cases
  let weaknessContext = '';
  if (testCaseKind === 'edge_case' && expectedFailures.length > 0) {
    weaknessContext = `\n\nKNOWN AGENT WEAKNESSES (this agent has failed at these in real calls):
${expectedFailures.map((f, i) => {
  const criterionDesc = f.description || f.key;
  const patternDesc = f.pattern_description || 'Observed failure pattern';
  const failInfo = f.fail_count ? ` (failed ${f.fail_count} times, impact: ${(f.impact_score || 0).toFixed(2)})` : '';
  return `${i + 1}. ${criterionDesc}: ${patternDesc}${failInfo}`;
}).join('\n')}

**CRITICAL**: This scenario is designed to expose these weaknesses. The agent MUST exhibit realistic struggles related to these failure patterns. Do NOT make the agent succeed perfectly - show how it struggles with these specific challenges.`;
  }

  const prompt = `You are simulating a phone conversation for testing a voice AI agent.

${testCaseKind === 'edge_case'
  ? `**THIS IS AN EDGE CASE TEST**: The scenario is designed to challenge the agent's known weaknesses. Generate a conversation where the agent demonstrates realistic struggles and failures, NOT a perfect interaction.`
  : `**THIS IS A HAPPY PATH TEST**: Generate a successful conversation where the agent handles the scenario well.`
}

AGENT PROMPT (how the agent is configured):
${agentPrompt}
${weaknessContext}

CALLER PERSONA:
Name: ${persona.name}
Age: ${persona.age || 'N/A'}
Occupation: ${persona.occupation || 'N/A'}
Communication Style: ${persona.communication_style || 'neutral'}
${persona.needs ? `Needs: ${persona.needs}` : ''}
${persona.challenge ? `Challenge: ${persona.challenge}` : ''}

SCENARIO:
${scenario}

Generate a realistic phone conversation with 8-12 turns (back and forth exchanges).

${testCaseKind === 'edge_case' ? `
**EDGE CASE REQUIREMENTS**:
- The agent MUST struggle with the challenges presented
- Show the agent making mistakes related to the known weaknesses listed above
- The agent should exhibit behaviors like:
  * Missing important information the caller provides
  * Failing to maintain proper tone under pressure
  * Not following the script when interrupted or confused
  * Using inappropriate language or filler words
  * Forgetting to collect required details
  * Mishandling objections or difficult questions
- Make the conversation realistic but challenging - the agent should NOT handle this perfectly
- The goal is to expose whether the agent can overcome its known weaknesses (it likely can't)
` : `
**HAPPY PATH REQUIREMENTS**:
- Generate a smooth, successful conversation
- Agent follows their prompt well
- Caller is cooperative and scenario unfolds naturally
- Agent collects necessary information and handles the call properly
`}

IMPORTANT: Respond with valid JSON in this exact structure:
{
  "conversation": [
    {"speaker": "agent", "text": "Hello! This is Maya from [Business Name]. How can I help you today?"},
    {"speaker": "caller", "text": "Hi, I'm calling about..."},
    {"speaker": "agent", "text": "..."},
    {"speaker": "caller", "text": "..."}
  ]
}`;

  const result = await callLLM({
    prompt,
    systemPrompt: testCaseKind === 'edge_case'
      ? 'You generate realistic phone conversation simulations that expose agent weaknesses. For edge cases, make the agent struggle and fail realistically based on known failure patterns. Output valid JSON only.'
      : 'You generate realistic phone conversation simulations for testing voice AI agents. Output valid JSON only.',
    stage: 'test_execution',
    temperature: testCaseKind === 'edge_case' ? 1.0 : 0.8, // Higher temperature for edge cases to encourage failures
    maxTokens: 16000,
    responseFormat: 'json'
  });

  try {
    const parsed = JSON.parse(result.content);
    // Handle both direct array and wrapped object responses
    const turns = Array.isArray(parsed) ? parsed : (parsed.turns || parsed.conversation || []);

    if (!Array.isArray(turns) || turns.length === 0) {
      throw new Error('Invalid conversation format');
    }

    return turns;
  } catch (err) {
    console.error('Failed to parse conversation:', err.message);
    console.error('LLM response:', result.content.substring(0, 200));
    // Return a minimal conversation
    return [
      { speaker: 'agent', text: 'Hello, how can I help you?' },
      { speaker: 'caller', text: scenario.substring(0, 200) }
    ];
  }
}

/**
 * Evaluate a single criterion against the conversation
 * Uses LLM to determine pass/fail
 */
async function evaluateCriterion(conversation, criterion, agentPrompt) {
  const conversationText = conversation
    .map(turn => `${turn.speaker.toUpperCase()}: ${turn.text}`)
    .join('\n');

  const prompt = `You are evaluating a voice AI agent's conversation against a specific criterion.

AGENT PROMPT (how agent should behave):
${agentPrompt}

CRITERION TO EVALUATE:
Key: ${criterion.key}
Description: ${criterion.description}
Category: ${criterion.category}
Check Type: ${criterion.check_type}

CONVERSATION:
${conversationText}

Evaluate whether the agent met this criterion.

Respond with JSON:
{
  "status": "pass" or "fail",
  "confidence": 0.0-1.0,
  "rationale": "Brief explanation of why the agent passed or failed this criterion",
  "evidence": "Quote specific parts of the conversation that support your evaluation"
}`;

  const result = await callLLM({
    prompt,
    systemPrompt: 'You evaluate voice AI agent performance against specific criteria. Output valid JSON only.',
    stage: 'test_evaluation',
    temperature: 0.3, // Lower temperature for more consistent evaluations
    maxTokens: 16000,
    responseFormat: 'json'
  });

  try {
    const evaluation = JSON.parse(result.content);
    return {
      status: evaluation.status,
      confidence: evaluation.confidence || 0.5,
      rationale: evaluation.rationale,
      evidence: evaluation.evidence,
      evidenceTurnIds: [] // In a real implementation, this would map to specific turn IDs
    };
  } catch (err) {
    console.error('Failed to parse evaluation:', err.message);
    return {
      status: 'fail',
      confidence: 0.5,
      rationale: 'Evaluation parsing failed',
      evidence: '',
      evidenceTurnIds: []
    };
  }
}

/**
 * Get test run details
 */
export async function getTestRun(testRunId) {
  const result = await db.query(
    `SELECT
       tr.*,
       av.agent_id,
       a.name as agent_name
     FROM test_runs tr
     JOIN agent_versions av ON tr.agent_version_id = av.id
     JOIN agents a ON av.agent_id = a.id
     WHERE tr.id = $1 AND tr.is_deleted = false`,
    [testRunId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Test run ${testRunId} not found`);
  }

  return result.rows[0];
}

/**
 * Get test results for a test run
 */
export async function getTestResults(testRunId) {
  const result = await db.query(
    `SELECT
       tr.*,
       tc.title as test_case_title,
       tc.kind as test_case_kind
     FROM test_results tr
     JOIN test_cases tc ON tr.test_case_id = tc.id
     WHERE tr.test_run_id = $1 AND tr.is_deleted = false
     ORDER BY tc.kind, tc.created_at, tr.attempt`,
    [testRunId]
  );

  return result.rows;
}

/**
 * Get test runs for an agent
 */
export async function getTestRunsForAgent(agentId, options = {}) {
  const { limit = 10 } = options;

  const result = await db.query(
    `SELECT
       tr.id,
       tr.trigger,
       tr.runs_per_case,
       tr.status,
       tr.started_at,
       tr.finished_at,
       tr.created_at,
       COUNT(tres.id) as total_tests,
       COUNT(tres.id) FILTER (WHERE tres.passed = true) as passed_tests,
       COUNT(tres.id) FILTER (WHERE tres.passed = false) as failed_tests
     FROM test_runs tr
     JOIN agent_versions av ON tr.agent_version_id = av.id
     LEFT JOIN test_results tres ON tr.id = tres.test_run_id AND tres.is_deleted = false
     WHERE av.agent_id = $1 AND tr.is_deleted = false
     GROUP BY tr.id, tr.trigger, tr.runs_per_case, tr.status, tr.started_at, tr.finished_at, tr.created_at
     ORDER BY tr.created_at DESC
     LIMIT $2`,
    [agentId, limit]
  );

  return result.rows;
}

export default {
  runTests,
  getTestRun,
  getTestResults,
  getTestRunsForAgent
};
