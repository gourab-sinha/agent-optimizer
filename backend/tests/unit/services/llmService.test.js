import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

import db from '../../../src/db/connection.js';
import llmService from '../../../src/services/llmService.js';
import Anthropic from '@anthropic-ai/sdk';

describe('services/llmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  it('callLLM uses anthropic provider and tracks call', async () => {
    // Anthropic mock is constructed at module load; grab instance methods via prototype is hard.
    // Re-import path uses the mock class from setup - call through public API.
    // We need to ensure messages.create is called - the singleton was created with mock.
    const result = await llmService.callLLM({
      prompt: 'hello',
      systemPrompt: 'sys',
      stage: 'test',
      refId: 'ref',
      responseFormat: 'json',
    });

    expect(result).toHaveProperty('content');
    expect(result.metadata.provider).toBe('anthropic');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO llm_calls'),
      expect.any(Array)
    );
  });

  it('callLLM continues when tracking fails', async () => {
    db.query.mockRejectedValueOnce(new Error('track fail'));
    const result = await llmService.callLLM({ prompt: 'x' });
    expect(result.content).toBeDefined();
  });

  it('calculateCost returns pricing for known models', () => {
    const cost = llmService.calculateCost(
      {
        model: 'claude-3-5-sonnet-20241022',
        promptTokens: 1000,
        completionTokens: 1000,
      },
      'anthropic'
    );
    expect(cost.totalCost).toBeGreaterThan(0);
    expect(cost.currency).toBe('USD');
  });

  it('calculateCost returns null for unknown model', () => {
    const cost = llmService.calculateCost(
      { model: 'unknown', promptTokens: 1, completionTokens: 1 },
      'anthropic'
    );
    expect(cost).toBeNull();
  });

  it('getLLMStats builds filtered query', async () => {
    db.query.mockResolvedValue({ rows: [{ stage: 'rubric', call_count: '1' }] });
    const rows = await llmService.getLLMStats({
      stage: 'rubric',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM llm_calls'),
      expect.arrayContaining(['rubric', '2024-01-01', '2024-12-31', 10])
    );
  });

  it('getLLMStats without filters', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await llmService.getLLMStats();
    expect(db.query).toHaveBeenCalled();
  });
});
