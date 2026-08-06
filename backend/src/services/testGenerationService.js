import db from '../db/connection.js';
import { callLLM } from './llmService.js';

/**
 * Test Case Generation Service
 * Generates realistic test cases from agent prompts and past call patterns
 */

/**
 * Generate test cases for an agent
 * Creates both happy-path and edge-case scenarios
 *
 * @param {string} agentId - Agent ID
 * @param {Object} options - Generation options
 * @param {number} options.happyPathCount - Number of happy path cases (default: 3)
 * @param {number} options.edgeCaseCount - Number of edge cases per pattern (default: 2)
 * @returns {Promise<Object>} Generated test cases
 */
export async function generateTestCases(agentId, options = {}) {
  const {
    happyPathCount = 3,
    edgeCaseCount = 2
  } = options;

  console.log(`\n🧪 Generating test cases for agent ${agentId}`);
  console.log(`   Happy path: ${happyPathCount}, Edge cases: ${edgeCaseCount} per pattern`);

  // Get agent details with latest version
  const agentResult = await db.query(
    `SELECT a.id, a.name, a.config,
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
  console.log(`   ✓ Prompt length: ${agentPrompt.length} chars`);

  // Get rubric for the agent version
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

  // Get rubric criteria (success criteria for tests)
  const criteriaResult = await db.query(
    `SELECT id, key, description, severity, category
     FROM rubric_criteria
     WHERE rubric_id = $1 AND is_deleted = false AND enabled = true
     ORDER BY severity DESC, category`,
    [rubricId]
  );

  const criteria = criteriaResult.rows;
  console.log(`   ✓ Found ${criteria.length} rubric criteria`);

  // Get past call transcripts for realistic patterns
  const callsResult = await db.query(
    `SELECT c.id, c.summary
     FROM calls c
     WHERE c.agent_id = $1 AND c.is_deleted = false
     ORDER BY c.created_at_ghl DESC
     LIMIT 5`,
    [agentId]
  );

  const pastCalls = callsResult.rows;
  console.log(`   ✓ Analyzing ${pastCalls.length} past calls for patterns`);

  // Get existing patterns (for edge case generation)
  const patternsResult = await db.query(
    `SELECT p.id, p.title, p.description, p.criterion_id,
            rc.key as criterion_key, rc.description as criterion_description
     FROM issue_patterns p
     JOIN rubric_criteria rc ON p.criterion_id = rc.id
     WHERE p.agent_version_id = $1 AND p.is_deleted = false
     ORDER BY p.impact_score DESC
     LIMIT 10`,
    [agent.version_id]
  );

  const patterns = patternsResult.rows;
  console.log(`   ✓ Found ${patterns.length} failure patterns for edge cases`);

  // Generate happy path test cases
  const happyPathCases = [];
  for (let i = 0; i < happyPathCount; i++) {
    console.log(`\n   → Generating happy path case ${i + 1}/${happyPathCount}...`);
    const testCase = await generateHappyPathCase(agent, agentPrompt, criteria, pastCalls);
    happyPathCases.push(testCase);
  }

  // Generate edge case test cases from patterns
  const edgeCases = [];
  for (const pattern of patterns.slice(0, 5)) { // Max 5 patterns
    console.log(`\n   → Generating edge cases for pattern: ${pattern.title}...`);
    for (let i = 0; i < edgeCaseCount; i++) {
      const testCase = await generateEdgeCase(agent, agentPrompt, pattern, criteria);
      edgeCases.push(testCase);
    }
  }

  console.log(`\n✅ Test case generation complete`);
  console.log(`   Happy path: ${happyPathCases.length} cases`);
  console.log(`   Edge cases: ${edgeCases.length} cases`);
  console.log(`   Total: ${happyPathCases.length + edgeCases.length} cases`);

  return {
    success: true,
    agentId,
    agentName: agent.name,
    happyPathCases,
    edgeCases,
    totalCases: happyPathCases.length + edgeCases.length
  };
}

/**
 * Generate a happy path test case
 * Simulates ideal customer interaction
 */
async function generateHappyPathCase(agent, agentPrompt, criteria, pastCalls) {
  const prompt = `You are generating a test case for a voice AI agent. Create a realistic happy-path scenario where the agent performs perfectly.

AGENT PROMPT:
${agentPrompt.substring(0, 2000)}...

EVALUATION CRITERIA (what the agent should do):
${criteria.map(c => `- ${c.key}: ${c.description}`).join('\n')}

${pastCalls.length > 0 ? `EXAMPLE PAST CALLS:
${pastCalls.slice(0, 2).map(c => `- ${c.summary}`).join('\n')}` : ''}

Generate a test case with:
1. **Caller Persona**: Demographics, needs, communication style
2. **Scenario**: What the caller wants to accomplish
3. **Expected Flow**: How the conversation should go
4. **Success Criteria**: Which criteria this tests (list criterion keys)

Format as JSON:
{
  "title": "Clear, descriptive title (e.g., 'Caller books appointment successfully')",
  "persona": {
    "name": "...",
    "age": 30,
    "occupation": "...",
    "communication_style": "clear/polite/rushed/etc",
    "needs": "..."
  },
  "scenario": "Detailed scenario description...",
  "expected_flow": "Step-by-step description of ideal conversation...",
  "criterion_keys": ["key1", "key2", "key3"]
}`;

  const result = await callLLM({
    prompt,
    systemPrompt: 'You generate realistic test scenarios for voice AI agents. Output valid JSON only.',
    stage: 'test_generation',
    temperature: 0.8,
    maxTokens: 800,
    responseFormat: 'json'
  });

  try {
    // Log the raw LLM response for debugging
    console.log(`      LLM Response: ${result.content.substring(0, 200)}...`);

    const parsed = JSON.parse(result.content);

    // Get criterion IDs from keys
    const criterionIds = criteria
      .filter(c => parsed.criterion_keys?.includes(c.key))
      .map(c => c.id);

    // Store in database
    const insertResult = await db.query(
      `INSERT INTO test_cases (
         agent_id,
         seeded_by_pattern_id,
         kind,
         title,
         persona,
         scenario,
         criterion_ids,
         extra_asserts
       ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        agent.id,
        'happy_path',
        parsed.title,
        JSON.stringify(parsed.persona),
        parsed.scenario + '\n\nExpected Flow:\n' + parsed.expected_flow,
        criterionIds,
        '[]'
      ]
    );

    console.log(`      ✓ Created: ${parsed.title}`);

    return {
      id: insertResult.rows[0].id,
      ...parsed,
      kind: 'happy_path'
    };
  } catch (err) {
    console.error('      ✗ Failed to parse LLM response:', err.message);
    console.error('      Full response:', result.content);
    throw new Error('Failed to generate happy path case');
  }
}

/**
 * Generate an edge case test case from a failure pattern
 * Tests specific scenarios where agent has failed before
 */
async function generateEdgeCase(agent, agentPrompt, pattern, criteria) {
  const prompt = `You are generating an edge-case test for a voice AI agent that has a known failure pattern.

AGENT PROMPT:
${agentPrompt.substring(0, 2000)}...

KNOWN FAILURE PATTERN:
- Title: ${pattern.title}
- Description: ${pattern.description}
- Failing Criterion: ${pattern.criterion_key} - ${pattern.criterion_description}

Generate a test case that specifically challenges this weakness:
1. **Caller Persona**: Create a challenging but realistic caller
2. **Scenario**: Design a situation that exposes this failure pattern
3. **Challenge**: What makes this difficult for the agent
4. **Success Criteria**: What the agent must do to pass

Format as JSON:
{
  "title": "Descriptive title highlighting the challenge (e.g., 'Impatient caller interrupts greeting')",
  "persona": {
    "name": "...",
    "age": 30,
    "occupation": "...",
    "communication_style": "impatient/confused/skeptical/etc",
    "challenge": "What makes this caller difficult"
  },
  "scenario": "Scenario description that triggers the known failure...",
  "expected_behavior": "How agent should handle this challenge...",
  "criterion_keys": ["${pattern.criterion_key}"]
}`;

  const result = await callLLM({
    prompt,
    systemPrompt: 'You generate challenging edge-case scenarios for voice AI testing. Output valid JSON only.',
    stage: 'test_generation',
    temperature: 0.9,
    maxTokens: 600,
    responseFormat: 'json'
  });

  try {
    const parsed = JSON.parse(result.content);

    // Get criterion IDs from keys
    const criterionIds = criteria
      .filter(c => parsed.criterion_keys?.includes(c.key))
      .map(c => c.id);

    // Always include the pattern's criterion
    if (!criterionIds.includes(pattern.criterion_id)) {
      criterionIds.push(pattern.criterion_id);
    }

    // Store in database
    const insertResult = await db.query(
      `INSERT INTO test_cases (
         agent_id,
         seeded_by_pattern_id,
         kind,
         title,
         persona,
         scenario,
         criterion_ids,
         extra_asserts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        agent.id,
        pattern.id,
        'edge_case',
        parsed.title,
        JSON.stringify(parsed.persona),
        parsed.scenario + '\n\nExpected Behavior:\n' + parsed.expected_behavior,
        criterionIds,
        '[]'
      ]
    );

    console.log(`      ✓ Created: ${parsed.title}`);

    return {
      id: insertResult.rows[0].id,
      ...parsed,
      kind: 'edge_case',
      pattern: pattern.title
    };
  } catch (err) {
    console.error('      ✗ Failed to parse LLM response:', err.message);
    throw new Error('Failed to generate edge case');
  }
}

/**
 * Get test cases for an agent
 */
export async function getTestCases(agentId, options = {}) {
  const { kind, includeArchived = false } = options;

  let query = `
    SELECT
      tc.id,
      tc.kind,
      tc.title,
      tc.persona,
      tc.scenario,
      tc.criterion_ids,
      tc.archived,
      tc.created_at,
      p.title as pattern_title
    FROM test_cases tc
    LEFT JOIN issue_patterns p ON tc.seeded_by_pattern_id = p.id
    WHERE tc.agent_id = $1 AND tc.is_deleted = false
  `;

  const params = [agentId];

  if (kind) {
    query += ` AND tc.kind = $${params.length + 1}`;
    params.push(kind);
  }

  if (!includeArchived) {
    query += ` AND tc.archived = false`;
  }

  query += ` ORDER BY tc.kind, tc.created_at DESC`;

  const result = await db.query(query, params);

  return result.rows;
}

/**
 * Get test case details
 */
export async function getTestCaseDetails(testCaseId) {
  const result = await db.query(
    `SELECT
       tc.*,
       p.title as pattern_title,
       p.description as pattern_description
     FROM test_cases tc
     LEFT JOIN issue_patterns p ON tc.seeded_by_pattern_id = p.id
     WHERE tc.id = $1 AND tc.is_deleted = false`,
    [testCaseId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Test case ${testCaseId} not found`);
  }

  return result.rows[0];
}

/**
 * Archive/unarchive a test case
 */
export async function archiveTestCase(testCaseId, archived = true) {
  const result = await db.query(
    `UPDATE test_cases
     SET archived = $1, updated_at = now()
     WHERE id = $2 AND is_deleted = false
     RETURNING id`,
    [archived, testCaseId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Test case ${testCaseId} not found`);
  }

  return result.rows[0];
}

export default {
  generateTestCases,
  getTestCases,
  getTestCaseDetails,
  archiveTestCase
};
