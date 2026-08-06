/**
 * LLM Service
 * Unified interface for OpenAI and Anthropic APIs
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import db from '../db/connection.js';

// LLM Provider Configuration
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'anthropic';

// OpenAI Client Configuration
const openaiClient = LLM_PROVIDER === 'openai' ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
}) : null;

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Anthropic Client Configuration
const anthropicClient = LLM_PROVIDER === 'anthropic' ? new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
}) : null;

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';

/**
 * Call LLM with automatic provider routing
 * @param {Object} options - Call options
 * @param {string} options.prompt - The prompt to send
 * @param {string} options.systemPrompt - System prompt (optional)
 * @param {string} options.stage - Stage identifier for tracking (e.g., 'rubric', 'finding')
 * @param {string} options.refId - Reference ID for tracking
 * @param {string} options.model - Override default model
 * @param {number} options.temperature - Temperature (0-1)
 * @param {number} options.maxTokens - Max tokens to generate
 * @param {string|Object} options.responseFormat - Response format ('json' or JSON schema object)
 * @returns {Promise<{content: string, usage: Object, metadata: Object}>}
 */
export async function callLLM({
  prompt,
  systemPrompt = null,
  stage = 'general',
  refId = null,
  model = null,
  temperature = 0.7,
  maxTokens = 4096,
  responseFormat = null,
}) {
  const startTime = Date.now();

  try {
    let result;

    if (LLM_PROVIDER === 'openai') {
      result = await callOpenAI({
        prompt,
        systemPrompt,
        model: model || OPENAI_MODEL,
        temperature,
        maxTokens,
        responseFormat,
      });
    } else if (LLM_PROVIDER === 'anthropic') {
      result = await callAnthropic({
        prompt,
        systemPrompt,
        model: model || ANTHROPIC_MODEL,
        temperature,
        maxTokens,
        responseFormat,
      });
    } else {
      throw new Error(`Invalid LLM_PROVIDER: ${LLM_PROVIDER}. Must be 'openai' or 'anthropic'`);
    }

    const latencyMs = Date.now() - startTime;

    // Track LLM call in database
    await trackLLMCall({
      stage,
      refId,
      model: result.model,
      temperature,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      latencyMs,
    });

    return {
      content: result.content,
      usage: result.usage,
      metadata: {
        provider: LLM_PROVIDER,
        model: result.model,
        latencyMs,
      }
    };

  } catch (error) {
    console.error(`[LLM Service] ${LLM_PROVIDER} API call failed:`, error.message);
    throw new Error(`LLM API call failed: ${error.message}`);
  }
}

/**
 * Call OpenAI API using official SDK
 */
async function callOpenAI({ prompt, systemPrompt, model, temperature, maxTokens, responseFormat }) {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Set LLM_PROVIDER=openai and OPENAI_API_KEY');
  }

  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: prompt });

  const requestParams = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  // Add response format if requested
  if (responseFormat) {
    if (responseFormat === 'json' || responseFormat === 'json_object') {
      requestParams.response_format = { type: 'json_object' };
    } else if (typeof responseFormat === 'object') {
      // If a schema is provided, use structured outputs (requires gpt-4o or later)
      requestParams.response_format = {
        type: 'json_schema',
        json_schema: responseFormat
      };
    }
  }

  const response = await openaiClient.chat.completions.create(requestParams);

  return {
    content: response.choices[0].message.content,
    model: response.model,
    usage: {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    }
  };
}

/**
 * Call Anthropic API using official SDK
 */
async function callAnthropic({ prompt, systemPrompt, model, temperature, maxTokens, responseFormat }) {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized. Set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY');
  }

  const params = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: 'user', content: prompt }
    ],
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  // For Anthropic, enforce JSON via system prompt enhancement
  if (responseFormat) {
    const jsonInstruction = '\n\nIMPORTANT: You must respond with valid JSON only. Do not include any text before or after the JSON object.';

    if (params.system) {
      params.system = params.system + jsonInstruction;
    } else {
      params.system = 'You are a helpful assistant that responds in JSON format.' + jsonInstruction;
    }
  }

  const response = await anthropicClient.messages.create(params);

  return {
    content: response.content[0].text,
    model: response.model,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    }
  };
}

/**
 * Track LLM call in database for cost and performance monitoring
 */
async function trackLLMCall({
  stage,
  refId,
  model,
  temperature,
  promptTokens,
  completionTokens,
  latencyMs,
}) {
  try {
    await db.query(
      `INSERT INTO llm_calls (
        stage, ref_id, model, temperature,
        prompt_tokens, completion_tokens, latency_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [stage, refId, model, temperature, promptTokens, completionTokens, latencyMs]
    );
  } catch (error) {
    console.error('[LLM Service] Failed to track LLM call:', error.message);
    // Don't throw - tracking failure shouldn't break the main flow
  }
}

/**
 * Get LLM call statistics
 */
export async function getLLMStats(options = {}) {
  const { stage, startDate, endDate, limit = 100 } = options;

  let query = `
    SELECT
      stage,
      model,
      COUNT(*) as call_count,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens,
      AVG(latency_ms) as avg_latency_ms,
      MAX(latency_ms) as max_latency_ms,
      MIN(latency_ms) as min_latency_ms
    FROM llm_calls
    WHERE is_deleted = false
  `;

  const params = [];

  if (stage) {
    params.push(stage);
    query += ` AND stage = $${params.length}`;
  }

  if (startDate) {
    params.push(startDate);
    query += ` AND created_at >= $${params.length}`;
  }

  if (endDate) {
    params.push(endDate);
    query += ` AND created_at <= $${params.length}`;
  }

  query += `
    GROUP BY stage, model
    ORDER BY call_count DESC
    LIMIT $${params.length + 1}
  `;
  params.push(limit);

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Calculate estimated cost based on token usage
 * Pricing as of January 2024
 */
export function calculateCost(usage, provider = LLM_PROVIDER) {
  const pricing = {
    openai: {
      'gpt-4o': {
        prompt: 0.005 / 1000,
        completion: 0.015 / 1000,
      },
      'gpt-4o-mini': {
        prompt: 0.00015 / 1000,
        completion: 0.0006 / 1000,
      },
    },
    anthropic: {
      'claude-3-5-sonnet-20241022': {
        prompt: 0.003 / 1000,
        completion: 0.015 / 1000,
      },
      'claude-3-5-haiku-20241022': {
        prompt: 0.0008 / 1000,
        completion: 0.004 / 1000,
      },
    },
  };

  const modelPricing = pricing[provider]?.[usage.model];

  if (!modelPricing) {
    console.warn(`Pricing not available for ${provider}/${usage.model}`);
    return null;
  }

  const promptCost = usage.promptTokens * modelPricing.prompt;
  const completionCost = usage.completionTokens * modelPricing.completion;

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    currency: 'USD',
  };
}

export default {
  callLLM,
  getLLMStats,
  calculateCost,
};
