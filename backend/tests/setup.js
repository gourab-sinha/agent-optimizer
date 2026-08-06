/**
 * Global test setup
 * - Environment variables required by modules at import time
 * - Shared mocks for external SDKs
 */
import { vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '1a08d39312d9f41435a91126a9bf9de53bd334d3404fe2394580a05120bc7aaa';
process.env.GHL_CLIENT_ID = process.env.GHL_CLIENT_ID || 'test-client-id';
process.env.GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || 'test-client-secret';
process.env.GHL_REDIRECT_URI =
  process.env.GHL_REDIRECT_URI || 'http://localhost:3000/api/oauth/callback';
process.env.GHL_SHARED_SECRET = process.env.GHL_SHARED_SECRET || 'test-shared-secret';
process.env.GHL_SCOPES =
  process.env.GHL_SCOPES || 'voice-ai-agents.readonly,voice-ai-agents.write';
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
process.env.PORT = process.env.PORT || '0';

// Mock HighLevel SDK (sdk-client instantiates at import)
vi.mock('@gohighlevel/api-client', () => {
  class SessionStorage {
    constructor() {}
  }

  class HighLevel {
    constructor() {
      this.oauth = {
        getAuthorizationUrl: vi.fn(
          (clientId, redirectUri, scopes) =>
            `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}&scope=${encodeURIComponent(scopes)}`
        ),
        getAccessToken: vi.fn(),
      };
      this.voiceAi = {
        getAgents: vi.fn(),
        getAgent: vi.fn(),
        createAgent: vi.fn(),
        patchAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getCallLogs: vi.fn(),
        getCallLog: vi.fn(),
        getAction: vi.fn(),
        createAction: vi.fn(),
        updateAction: vi.fn(),
        deleteAction: vi.fn(),
      };
      this.locations = {};
    }
  }

  return { HighLevel, SessionStorage };
});

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      constructor() {
        this.messages = {
          create: vi.fn().mockResolvedValue({
            content: [{ text: '{}' }],
            model: 'claude-3-5-sonnet-20241022',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        };
      }
    },
  };
});

// Mock OpenAI SDK
vi.mock('openai', () => {
  return {
    default: class OpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{}' } }],
              model: 'gpt-4o',
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            }),
          },
        };
      }
    },
  };
});
