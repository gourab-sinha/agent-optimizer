import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

vi.mock('../../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => `enc:${t}`),
  decrypt: vi.fn((t) => String(t).replace(/^enc:/, '')),
}));

import db from '../../../src/db/connection.js';
import {
  PostgreSQLSessionStorage,
  GHLClient,
} from '../../../src/ghl/sdk-client.js';

describe('ghl/sdk-client PostgreSQLSessionStorage + GHLClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('session storage lifecycle methods', async () => {
    const storage = new PostgreSQLSessionStorage();
    storage.setClientId('cid');
    await storage.init();
    await storage.disconnect();
    await storage.createCollection('c');
    expect(await storage.getCollection('c')).toBe('c');

    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
    await storage.setSession('res-1', {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 100,
    });
    await storage.setSession('res-2', {
      access_token: 'a',
      refresh_token: 'r',
      expires_at: Date.now() + 10000,
    });

    db.query.mockRejectedValueOnce(new Error('store fail'));
    await expect(
      storage.setSession('res-3', {
        access_token: 'a',
        refresh_token: 'r',
      })
    ).rejects.toThrow('store fail');

    db.query.mockResolvedValue({ rows: [] });
    expect(await storage.getSession('missing')).toBeNull();

    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:tok',
          refresh_token: 'enc:ref',
          token_expires_at: new Date().toISOString(),
        },
      ],
    });
    const session = await storage.getSession('res-1');
    expect(session.access_token).toBe('tok');
    expect(session.resourceId).toBe('res-1');

    db.query.mockRejectedValueOnce(new Error('get fail'));
    expect(await storage.getSession('x')).toBeNull();

    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
    await storage.deleteSession('res-1');
    db.query.mockRejectedValueOnce(new Error('del fail'));
    await expect(storage.deleteSession('x')).rejects.toThrow('del fail');

    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:a',
          refresh_token: 'enc:r',
          token_expires_at: null,
        },
      ],
    });
    expect(await storage.getAccessToken('res')).toBe('a');
    expect(await storage.getRefreshToken('res')).toBe('r');

    db.query.mockResolvedValue({ rows: [] });
    expect(await storage.getAccessToken('x')).toBeNull();
    expect(await storage.getRefreshToken('x')).toBeNull();

    db.query.mockResolvedValue({
      rows: [
        {
          resourceid: 'r1',
          access_token: 'enc:a',
          refresh_token: 'enc:r',
          token_expires_at: new Date().toISOString(),
        },
      ],
    });
    const sessions = await storage.getSessionsByApplication();
    expect(sessions).toHaveLength(1);

    db.query.mockRejectedValueOnce(new Error('list fail'));
    expect(await storage.getSessionsByApplication()).toEqual([]);
  });

  it('GHLClient throws without credentials', () => {
    const origId = process.env.GHL_CLIENT_ID;
    const origSecret = process.env.GHL_CLIENT_SECRET;
    delete process.env.GHL_CLIENT_ID;
    delete process.env.GHL_CLIENT_SECRET;
    expect(() => new GHLClient()).toThrow(
      'GHL_CLIENT_ID and GHL_CLIENT_SECRET'
    );
    process.env.GHL_CLIENT_ID = origId;
    process.env.GHL_CLIENT_SECRET = origSecret;
  });
});
