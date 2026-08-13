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
 * @param {number} options.maxTotalCases - Maximum total test cases (default: 10)
 * @param {number} options.minHappyPath - Minimum happy path cases (default: 2)
 * @param {number} options.edgeCasePerPattern - Edge cases per pattern (default: 1)
 * @returns {Promise<Object>} Generated test cases
 */
export async function generateTestCases(agentId, options = {}) {
  const {
    maxTotalCases = 10,
    minHappyPath = 2,
    edgeCasePerPattern = 1
  } = options;

  console.log(`\n🧪 Generating test cases for agent ${agentId}`);
  console.log(`   Max total cases: ${maxTotalCases}, Min happy path: ${minHappyPath}`);

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
            rc.key as criterion_key, rc.description as criterion_description,
            p.impact_score, p.call_count
     FROM issue_patterns p
     JOIN rubric_criteria rc ON p.criterion_id = rc.id
     WHERE p.agent_version_id = $1 AND p.is_deleted = false
     ORDER BY p.impact_score DESC
     LIMIT 10`,
    [agent.version_id]
  );

  const patterns = patternsResult.rows;
  console.log(`   ✓ Found ${patterns.length} failure patterns for edge cases`);

  // Get actual failing calls with findings for context
  const findingsResult = await db.query(
    `SELECT f.id, f.call_id, f.status, f.rationale, f.confidence,
            rc.key as criterion_key, rc.description as criterion_description,
            c.summary as call_summary
     FROM findings f
     JOIN rubric_criteria rc ON f.criterion_id = rc.id
     JOIN calls c ON f.call_id = c.id
     WHERE f.rubric_id = $1 AND f.status = 'fail' AND f.is_deleted = false
     ORDER BY f.confidence DESC, f.created_at DESC
     LIMIT 20`,
    [rubricId]
  );

  const failingFindings = findingsResult.rows;
  console.log(`   ✓ Found ${failingFindings.length} actual failures to learn from`);

  // Calculate optimal distribution
  // Strategy: Generate as many edge cases as we have patterns (up to limit),
  // then fill remaining budget with happy paths
  const maxEdgeCases = Math.min(patterns.length * edgeCasePerPattern, maxTotalCases - minHappyPath);
  const actualEdgeCaseCount = Math.max(0, maxEdgeCases);
  const actualHappyPathCount = Math.min(maxTotalCases - actualEdgeCaseCount, Math.max(minHappyPath, maxTotalCases - actualEdgeCaseCount));

  console.log(`   Distribution: ${actualHappyPathCount} happy path + ${actualEdgeCaseCount} edge cases = ${actualHappyPathCount + actualEdgeCaseCount} total`);

  // Generate happy path test cases
  const happyPathCases = [];
  for (let i = 0; i < actualHappyPathCount; i++) {
    console.log(`\n   → Generating happy path case ${i + 1}/${actualHappyPathCount}...`);
    const testCase = await generateHappyPathCase(agent, agentPrompt, criteria, pastCalls);
    happyPathCases.push(testCase);
  }

  // Generate edge case test cases from patterns (prioritize high-impact patterns)
  const edgeCases = [];
  const patternsToUse = patterns.slice(0, Math.ceil(actualEdgeCaseCount / edgeCasePerPattern));

  for (const pattern of patternsToUse) {
    if (edgeCases.length >= actualEdgeCaseCount) break; // Stop if we've hit our limit

    console.log(`\n   → Generating edge cases for pattern: ${pattern.title}...`);

    // Get findings related to this pattern's criterion
    const relatedFindings = failingFindings.filter(f => f.criterion_key === pattern.criterion_key).slice(0, 3);

    const casesToGenerate = Math.min(edgeCasePerPattern, actualEdgeCaseCount - edgeCases.length);
    for (let i = 0; i < casesToGenerate; i++) {
      const testCase = await generateEdgeCase(agent, agentPrompt, pattern, criteria, relatedFindings);
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
${agentPrompt}...

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
    systemPrompt: `You are an expert QA engineer specializing in voice AI testing. Your role is to create realistic, comprehensive test scenarios that validate agent behavior across diverse customer interactions.

Key principles:
- Generate scenarios that mirror real customer conversations
- Create personas with authentic demographic details and communication patterns
- Design test flows that validate multiple success criteria simultaneously
- Ensure scenarios are specific enough to be actionable but flexible enough to allow natural conversation
- Focus on real-world use cases, not edge cases (save those for edge-case generation)

Output format: Return ONLY valid JSON matching the specified schema. No markdown, no code blocks, just pure JSON.`,
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
async function generateEdgeCase(agent, agentPrompt, pattern, criteria, relatedFindings = []) {
  // Build findings context to show real failures
  let findingsContext = '';
  if (relatedFindings.length > 0) {
    findingsContext = '\n\nREAL FAILURE EXAMPLES:\n';
    relatedFindings.forEach((finding, idx) => {
      findingsContext += `${idx + 1}. ${finding.call_summary}\n`;
      findingsContext += `   WHY IT FAILED: ${finding.rationale}\n`;
      findingsContext += `   Confidence: ${Math.round(finding.confidence * 100)}%\n`;
    });
  }

  const prompt = `You are generating an edge-case test for a voice AI agent that has a known failure pattern.

AGENT PROMPT:
${agentPrompt}...

KNOWN FAILURE PATTERN:
- Title: ${pattern.title}
- Description: ${pattern.description}
- Failing Criterion: ${pattern.criterion_key} - ${pattern.criterion_description}
- Impact: ${pattern.call_count} calls affected (${Math.round(pattern.impact_score * 100)}% impact)
${findingsContext}

IMPORTANT: Create a test case that will LIKELY FAIL based on the real failures above.
- Study the real failure examples carefully
- Mimic the conditions that caused those failures
- Make the scenario challenging enough that the agent will struggle
- The goal is to TEST if the agent can handle its known weaknesses

Generate a test case that specifically challenges this weakness:
1. **Caller Persona**: Create a challenging but realistic caller (based on real failures)
2. **Scenario**: Design a situation that exposes this failure pattern
3. **Challenge**: What makes this difficult (mirror the real failures)
4. **Success Criteria**: What the agent must do to pass (the failing criterion)

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
    systemPrompt: `You are a specialized QA engineer focused on adversarial testing for voice AI agents. Your expertise is in creating challenging edge-case scenarios that expose known weaknesses and failure patterns.

Your approach:
- Study real failure examples carefully to understand root causes
- Design scenarios that deliberately trigger known failure modes
- Create realistic but difficult personas (impatient, confused, skeptical, non-native speakers, etc.)
- Introduce complexities that have historically caused the agent to fail (interruptions, multi-part requests, unclear needs, etc.)
- The goal is NOT to trick the agent unfairly, but to test if it can handle realistic difficult situations

Critical: Base your scenarios on the REAL FAILURE EXAMPLES provided. Mirror the conditions, persona types, and conversation patterns that led to actual failures. This ensures your test cases are grounded in reality, not hypothetical.

Output format: Return ONLY valid JSON matching the specified schema. No markdown, no code blocks, just pure JSON.`,
    stage: 'test_generation',
    temperature: 0.9,
    maxTokens: 16000,
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
function asPersona(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

export async function updateTestCase(testCaseId, patch = {}) {
  const current = await getTestCaseDetails(testCaseId);
  const title = patch.title != null ? String(patch.title).trim() : current.title;
  const scenario = patch.scenario != null ? String(patch.scenario).trim() : current.scenario;
  const persona = patch.persona && typeof patch.persona === 'object'
    ? { ...asPersona(current.persona), ...patch.persona }
    : asPersona(current.persona);

  if (!title) throw new Error('Test case title is required');
  if (!scenario) throw new Error('Test case scenario is required');

  const result = await db.query(
    `UPDATE test_cases
     SET title = $1,
         scenario = $2,
         persona = $3,
         updated_at = now()
     WHERE id = $4 AND is_deleted = false
     RETURNING *`,
    [title, scenario, JSON.stringify(persona), testCaseId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Test case ${testCaseId} not found`);
  }

  return result.rows[0];
}

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
  updateTestCase,
  archiveTestCase
};
