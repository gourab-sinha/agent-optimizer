#!/usr/bin/env node

/**
 * Test Analysis System with Real Agent Data
 * Uses actual agent and call data from HighLevel
 */

import dotenv from 'dotenv';
import db from '../src/db/connection.js';
import { generateRubricForAgentVersion, evaluateCall } from '../src/services/rubricEvaluationService.js';

dotenv.config();

const AGENT_ID = '6a730523fa14242d523f6004';

async function testWithRealData() {
  try {
    console.log('\n🧪 Testing Analysis System with Real Data');
    console.log('═'.repeat(80));
    console.log(`Agent ID: ${AGENT_ID}`);
    console.log('═'.repeat(80));

    // Step 1: Check if agent exists
    console.log('\n📝 Step 1: Checking agent data...');
    const agentResult = await db.query(
      `SELECT id, name FROM agents WHERE id = $1 AND is_deleted = false`,
      [AGENT_ID]
    );

    if (agentResult.rows.length === 0) {
      console.error(`❌ Agent ${AGENT_ID} not found in database`);
      console.log('\nPlease sync the agent first:');
      console.log(`curl -X POST http://localhost:5000/api/agents/sync -d '{"locationId": "your-location-id"}'`);
      process.exit(1);
    }

    const agent = agentResult.rows[0];
    console.log(`✓ Agent found: ${agent.name}`);

    // Step 2: Get or create agent version
    console.log('\n📝 Step 2: Getting agent version...');
    const versionResult = await db.query(
      `SELECT id, label, config, actions FROM agent_versions
       WHERE agent_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [AGENT_ID]
    );

    if (versionResult.rows.length === 0) {
      console.error(`❌ No agent version found for agent ${AGENT_ID}`);
      console.log('\nPlease sync the agent to create a version:');
      console.log(`curl -X POST http://localhost:5000/api/agents/sync -d '{"locationId": "your-location-id"}'`);
      process.exit(1);
    }

    const version = versionResult.rows[0];
    console.log(`✓ Agent version found: ${version.id}`);
    console.log(`  Label: ${version.label}`);

    // Display agent config
    console.log('\n📋 Agent Configuration:');
    console.log('─'.repeat(80));
    const config = version.config;
    if (config.prompt) {
      const promptPreview = config.prompt.length > 500
        ? config.prompt.substring(0, 500) + '...'
        : config.prompt;
      console.log('Prompt:');
      console.log(promptPreview);
      console.log(`\nFull prompt length: ${config.prompt.length} characters`);
    }
    console.log(`Model: ${config.model || 'Not specified'}`);
    console.log(`Temperature: ${config.temperature || 'Not specified'}`);

    if (Array.isArray(version.actions) && version.actions.length > 0) {
      console.log(`\nActions (${version.actions.length}):`);
      version.actions.forEach(action => {
        console.log(`  - ${action.name || action.title || 'unnamed'}`);
      });
    }
    console.log('─'.repeat(80));

    // Step 3: Generate rubric
    console.log('\n📝 Step 3: Generating rubric from real agent config...');
    console.log('This will analyze the agent\'s actual prompt and configuration...');
    console.log('⏳ Please wait, this may take 2-5 seconds...\n');

    const startRubric = Date.now();
    const rubricResult = await generateRubricForAgentVersion(version.id);
    const rubricTime = Date.now() - startRubric;

    console.log(`✅ Rubric Generated!`);
    console.log(`   Rubric ID: ${rubricResult.rubricId}`);
    console.log(`   Criteria Count: ${rubricResult.criteriaCount}`);
    console.log(`   Cached: ${rubricResult.cached}`);
    console.log(`   Time: ${rubricTime}ms`);

    // Step 4: Fetch and display criteria
    const criteriaResult = await db.query(
      `SELECT key, category, description, check_type, check_spec, severity
       FROM rubric_criteria
       WHERE rubric_id = $1 AND is_deleted = false
       ORDER BY severity DESC, category`,
      [rubricResult.rubricId]
    );

    console.log('\n📋 Generated Criteria:');
    console.log('═'.repeat(80));

    // Group by category
    const byCategory = {};
    for (const criterion of criteriaResult.rows) {
      if (!byCategory[criterion.category]) {
        byCategory[criterion.category] = [];
      }
      byCategory[criterion.category].push(criterion);
    }

    for (const [category, criteria] of Object.entries(byCategory)) {
      console.log(`\n🏷️  ${category.toUpperCase().replace('_', ' ')}`);
      console.log('─'.repeat(80));

      for (const criterion of criteria) {
        const severityLabel = criterion.severity === 3 ? '🔴 Critical' :
                             criterion.severity === 2 ? '🟡 Important' : '🟢 Polish';

        console.log(`\n${criterion.key}`);
        console.log(`  ${severityLabel} | ${criterion.check_type}`);
        console.log(`  ${criterion.description}`);

        if (criterion.check_type === 'deterministic') {
          const spec = criterion.check_spec;
          console.log(`  Check: ${spec.kind}`);
          if (spec.kind === 'agent_said_any' && spec.phrases) {
            console.log(`  Phrases: ${spec.phrases.slice(0, 3).join(', ')}${spec.phrases.length > 3 ? '...' : ''}`);
          } else if (spec.kind === 'agent_said_none' && spec.forbiddenPhrases) {
            console.log(`  Forbidden: ${spec.forbiddenPhrases.join(', ')}`);
          } else if (spec.kind === 'action_executed') {
            console.log(`  Action: ${spec.actionName}`);
          } else if (spec.kind === 'extracted_field') {
            console.log(`  Field: ${spec.field} (${spec.required ? 'required' : 'optional'})`);
          } else if (spec.kind === 'duration_between') {
            console.log(`  Duration: ${spec.minSeconds}s - ${spec.maxSeconds}s`);
          }
        } else if (criterion.check_type === 'llm') {
          console.log(`  Question: "${criterion.check_spec.question}"`);
        }
      }
    }
    console.log('\n' + '═'.repeat(80));

    // Step 5: Get calls for this agent
    console.log('\n📝 Step 4: Checking for real calls to evaluate...');
    const callsResult = await db.query(
      `SELECT id, created_at_ghl, duration_s, summary
       FROM calls
       WHERE agent_id = $1 AND is_deleted = false
       ORDER BY created_at_ghl DESC
       LIMIT 5`,
      [AGENT_ID]
    );

    if (callsResult.rows.length === 0) {
      console.log('⚠️  No calls found for this agent');
      console.log('\nTo sync calls, run:');
      console.log(`curl -X POST http://localhost:5000/api/calls/sync -d '{"agentId": "${AGENT_ID}"}'`);
      console.log('\n✅ Rubric generation test completed successfully!');
      console.log('   You can now use this rubric to evaluate calls once they are synced.');
      process.exit(0);
    }

    console.log(`✓ Found ${callsResult.rows.length} calls (showing first 5)`);
    console.log('\nCalls:');
    callsResult.rows.forEach((call, i) => {
      console.log(`  ${i + 1}. ${call.id} - ${call.duration_s}s - ${call.created_at_ghl}`);
      if (call.summary) {
        console.log(`     ${call.summary.substring(0, 80)}${call.summary.length > 80 ? '...' : ''}`);
      }
    });

    // Step 6: Evaluate first call
    const testCall = callsResult.rows[0];
    console.log(`\n📝 Step 5: Evaluating first call: ${testCall.id}`);
    console.log('⏳ This will run both deterministic and LLM checks...\n');

    const startEval = Date.now();
    const evalResult = await evaluateCall(testCall.id, rubricResult.rubricId);
    const evalTime = Date.now() - startEval;

    console.log(`✅ Evaluation Complete!`);
    console.log(`   Findings Created: ${evalResult.findingsCreated}`);
    console.log(`   Time: ${evalTime}ms`);

    // Step 7: Display findings
    console.log('\n📊 Evaluation Results:');
    const findingsResult = await db.query(
      `SELECT
        f.status,
        f.confidence,
        f.rationale,
        f.method,
        f.evidence_turn_ids,
        rc.key,
        rc.category,
        rc.description,
        rc.severity
       FROM findings f
       JOIN rubric_criteria rc ON f.criterion_id = rc.id
       WHERE f.call_id = $1
       ORDER BY rc.severity DESC, f.status, rc.category`,
      [testCall.id]
    );

    // Group by status
    const grouped = {
      pass: [],
      fail: [],
      partial: [],
      na: [],
      missed_opportunity: []
    };

    for (const finding of findingsResult.rows) {
      grouped[finding.status].push(finding);
    }

    const passCount = grouped.pass.length;
    const failCount = grouped.fail.length;
    const totalCount = findingsResult.rows.length;
    const passRate = ((passCount / totalCount) * 100).toFixed(1);

    console.log('\n' + '═'.repeat(80));
    console.log('EVALUATION SUMMARY');
    console.log('═'.repeat(80));
    console.log(`\n📊 Overall:`);
    console.log(`   Total Criteria Evaluated: ${totalCount}`);
    console.log(`   ✅ Passed: ${passCount} (${passRate}%)`);
    console.log(`   ❌ Failed: ${failCount} (${(100 - parseFloat(passRate)).toFixed(1)}%)`);
    console.log(`   ⚠️  Partial: ${grouped.partial.length}`);
    console.log(`   ➖ N/A: ${grouped.na.length}`);
    console.log(`   💡 Missed Opportunity: ${grouped.missed_opportunity.length}`);

    // Display failures first (most important)
    if (failCount > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('❌ FAILURES (Areas for Improvement):');
      console.log('─'.repeat(80));

      for (const finding of grouped.fail) {
        const severityLabel = finding.severity === 3 ? '🔴 CRITICAL' :
                             finding.severity === 2 ? '🟡 Important' : '🟢 Polish';

        console.log(`\n${severityLabel} [${finding.category}] ${finding.key}`);
        console.log(`  ${finding.description}`);
        console.log(`  Method: ${finding.method} | Confidence: ${(finding.confidence * 100).toFixed(0)}%`);
        console.log(`  Reason: ${finding.rationale}`);

        if (finding.evidence_turn_ids && finding.evidence_turn_ids.length > 0) {
          console.log(`  Evidence: ${finding.evidence_turn_ids.length} turn(s)`);
        }
      }
    }

    // Display passes
    if (passCount > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('✅ PASSES (What Went Well):');
      console.log('─'.repeat(80));

      for (const finding of grouped.pass.slice(0, 5)) { // Show first 5 passes
        console.log(`\n✓ [${finding.category}] ${finding.key}`);
        console.log(`  ${finding.rationale}`);
      }

      if (passCount > 5) {
        console.log(`\n  ... and ${passCount - 5} more passes`);
      }
    }

    console.log('\n' + '═'.repeat(80));

    // Step 8: LLM usage stats
    console.log('\n📊 LLM Usage Statistics:');
    const llmStats = await db.query(
      `SELECT
        stage,
        COUNT(*) as calls,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        AVG(latency_ms) as avg_latency
       FROM llm_calls
       WHERE ref_id = $1 OR ref_id = $2
       GROUP BY stage`,
      [version.id, testCall.id]
    );

    if (llmStats.rows.length > 0) {
      console.log('\nStage          | Calls | Tokens (in/out) | Avg Latency');
      console.log('─'.repeat(80));
      for (const stat of llmStats.rows) {
        const stage = stat.stage.padEnd(14);
        const calls = String(stat.calls).padStart(5);
        const tokens = `${stat.total_prompt_tokens}/${stat.total_completion_tokens}`.padStart(15);
        const latency = `${Math.round(stat.avg_latency)}ms`.padStart(11);
        console.log(`${stage} | ${calls} | ${tokens} | ${latency}`);
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('✅ REAL DATA TEST COMPLETED SUCCESSFULLY!');
    console.log('═'.repeat(80));

    console.log('\n💡 Next Steps:');
    console.log('   1. Evaluate more calls:');
    console.log(`      curl -X POST http://localhost:5000/api/analysis/evaluate \\`);
    console.log(`        -H "Content-Type: application/json" \\`);
    console.log(`        -d '{"rubricId": "${rubricResult.rubricId}", "callIds": ["call1", "call2"]}'`);
    console.log('\n   2. View findings via API:');
    console.log(`      curl http://localhost:5000/api/analysis/findings/${testCall.id}`);
    console.log('\n   3. Build Pattern Detection to identify recurring issues across calls');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run test
testWithRealData();
