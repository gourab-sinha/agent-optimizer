import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('services/llmService OpenAI provider path', () => {
  const originalProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    process.env.LLM_PROVIDER = originalProvider;
    vi.resetModules();
    vi.doUnmock('../../../src/db/connection.js');
    vi.doUnmock('openai');
    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('callLLM routes to OpenAI with json response formats', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      model: 'gpt-4o',
      usage: {
        prompt_tokens: 5,
        completion_tokens: 3,
        total_tokens: 8,
      },
    });

    vi.resetModules();
    vi.doMock('../../../src/db/connection.js', () => ({
      default: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        getClient: vi.fn(),
        healthCheck: vi.fn(),
        close: vi.fn(),
        pool: {},
      },
    }));
    vi.doMock('openai', () => ({
      default: class OpenAI {
        constructor() {
          this.chat = { completions: { create } };
        }
      },
    }));
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class Anthropic {
        constructor() {
          this.messages = { create: vi.fn() };
        }
      },
    }));

    const { callLLM, calculateCost } = await import(
      '../../../src/services/llmService.js'
    );

    const result = await callLLM({
      prompt: 'hi',
      systemPrompt: 'sys',
      responseFormat: 'json',
    });
    expect(result.content).toContain('ok');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      })
    );

    await callLLM({
      prompt: 'hi',
      responseFormat: { name: 'schema', schema: { type: 'object' } },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({ type: 'json_schema' }),
      })
    );

    const cost = calculateCost(
      {
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 1000,
      },
      'openai'
    );
    expect(cost.totalCost).toBeGreaterThan(0);

    const mini = calculateCost(
      {
        model: 'gpt-4o-mini',
        promptTokens: 1000,
        completionTokens: 1000,
      },
      'openai'
    );
    expect(mini.totalCost).toBeGreaterThan(0);
  });

  it('throws for invalid LLM_PROVIDER', async () => {
    process.env.LLM_PROVIDER = 'invalid-provider';
    vi.resetModules();
    vi.doMock('../../../src/db/connection.js', () => ({
      default: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        getClient: vi.fn(),
        healthCheck: vi.fn(),
        close: vi.fn(),
        pool: {},
      },
    }));
    vi.doMock('openai', () => ({ default: class OpenAI {} }));
    vi.doMock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }));

    const { callLLM } = await import('../../../src/services/llmService.js');
    await expect(callLLM({ prompt: 'x' })).rejects.toThrow('Invalid LLM_PROVIDER');
  });
});
