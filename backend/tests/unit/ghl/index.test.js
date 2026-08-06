import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

vi.mock('../../../src/ghl/sdk-client.js', () => ({
  default: {
    oauth: {
      getAuthorizationUrl: vi.fn(() => 'https://example.com'),
      getAccessToken: vi.fn(),
    },
    voiceAi: vi.fn(() => ({})),
  },
}));

vi.mock('../../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => t),
  decrypt: vi.fn((t) => t),
}));

describe('ghl/index exports', () => {
  it('re-exports client, oauth, agents, calls symbols', async () => {
    const mod = await import('../../../src/ghl/index.js');
    expect(mod.ghl).toBeTypeOf('function');
    expect(mod.getRequestLog).toBeTypeOf('function');
    expect(mod.clearRequestLog).toBeTypeOf('function');
    expect(mod.getRequestStats).toBeTypeOf('function');
    expect(mod.getAuthorizationUrl).toBeTypeOf('function');
    expect(mod.generateState).toBeTypeOf('function');
    expect(mod.listAgents).toBeTypeOf('function');
    expect(mod.listCalls).toBeTypeOf('function');
  });
});
