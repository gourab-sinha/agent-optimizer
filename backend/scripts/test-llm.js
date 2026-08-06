#!/usr/bin/env node

/**
 * Test LLM Service
 * Quick test to verify OpenAI or Anthropic integration works
 */

import dotenv from 'dotenv';
import { callLLM, calculateCost } from '../src/services/llmService.js';

dotenv.config();

async function testLLM() {
  const provider = process.env.LLM_PROVIDER || 'anthropic';

  console.log('\n🧪 Testing LLM Service');
  console.log('═'.repeat(50));
  console.log(`Provider: ${provider}`);
  console.log('═'.repeat(50));

  try {
    console.log('\nSending test prompt...');

    const result = await callLLM({
      prompt: 'What is 2+2? Answer with just the number.',
      systemPrompt: 'You are a helpful assistant.',
      stage: 'test',
      temperature: 0,
      maxTokens: 100,
    });

    console.log('\n✅ LLM Call Successful\n');
    console.log('Response:', result.content);
    console.log('\nMetadata:');
    console.log('  Provider:', result.metadata.provider);
    console.log('  Model:', result.metadata.model);
    console.log('  Latency:', result.metadata.latencyMs + 'ms');

    console.log('\nToken Usage:');
    console.log('  Prompt Tokens:', result.usage.promptTokens);
    console.log('  Completion Tokens:', result.usage.completionTokens);
    console.log('  Total Tokens:', result.usage.totalTokens);

    const cost = calculateCost(result.usage, provider);
    if (cost) {
      console.log('\nEstimated Cost:');
      console.log('  Prompt:', '$' + cost.promptCost.toFixed(6));
      console.log('  Completion:', '$' + cost.completionCost.toFixed(6));
      console.log('  Total:', '$' + cost.totalCost.toFixed(6));
    }

    console.log('\n✅ Test completed successfully!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nError details:', error);
    console.error('\nCheck your .env file:');
    console.error(`  ${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} must be set`);
    console.error(`  LLM_PROVIDER=${provider}`);
    process.exit(1);
  }
}

testLLM();
