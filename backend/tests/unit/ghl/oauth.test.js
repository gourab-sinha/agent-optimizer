import { describe, it, expect, vi, beforeEach } from 'vitest';

const { oauthSdk } = vi.hoisted(() => ({
  oauthSdk: {
    getAuthorizationUrl: vi.fn(
      (clientId, redirectUri, scopes) =>
        `https://example.com/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scopes}`
    ),
    getAccessToken: vi.fn(),
  },
}));

vi.mock('../../../src/ghl/sdk-client.js', () => ({
  default: {
    oauth: oauthSdk,
    voiceAi: vi.fn(),
  },
}));

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
  decrypt: vi.fn((t) => t),
}));

vi.mock('../../../src/ghl/agents.js', () => ({
  listAgents: vi.fn(),
}));

vi.mock('../../../src/services/agentSyncService.js', () => ({
  syncAgent: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { listAgents } from '../../../src/ghl/agents.js';
import { syncAgent } from '../../../src/services/agentSyncService.js';
import oauth from '../../../src/ghl/oauth.js';

describe('ghl/oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getAuthorizationUrl with and without state', () => {
    const url = oauth.getAuthorizationUrl('state123');
    expect(url).toContain('state=state123');
    const url2 = oauth.getAuthorizationUrl();
    expect(url2).not.toContain('state=');
  });

  it('generateState returns hex string', () => {
    const s = oauth.generateState();
    expect(s).toMatch(/^[a-f0-9]{64}$/);
  });

  it('exchangeCodeForToken success with locationId', async () => {
    oauthSdk.getAccessToken.mockResolvedValue({
      access_token: 'access12345678',
      refresh_token: 'refresh12345678',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'x',
      locationId: 'loc-1',
      companyId: 'co-1',
      userId: 'u1',
      userType: 'Location',
      extraField: 'keep',
    });
    const data = await oauth.exchangeCodeForToken('code');
    expect(data.locationId).toBe('loc-1');
    expect(data.accessToken).toBe('access12345678');
  });

  it('exchangeCodeForToken falls back to companyId', async () => {
    oauthSdk.getAccessToken.mockResolvedValue({
      access_token: 'a12345678',
      refresh_token: 'r12345678',
      companyId: 'co-1',
    });
    const data = await oauth.exchangeCodeForToken('code');
    expect(data.locationId).toBeNull();
    expect(data.companyId).toBe('co-1');
  });

  it('exchangeCodeForToken throws on failure', async () => {
    oauthSdk.getAccessToken.mockRejectedValue({
      message: 'bad',
      response: { data: { error_description: 'invalid' }, status: 400 },
    });
    await expect(oauth.exchangeCodeForToken('x')).rejects.toThrow(
      'Failed to exchange authorization code'
    );
  });

  it('storeLocation inserts new location', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // existing
        .mockResolvedValueOnce(undefined) // insert
        .mockResolvedValueOnce(undefined), // COMMIT
      release: vi.fn(),
    };
    db.getClient.mockResolvedValue(client);

    const result = await oauth.storeLocation({
      locationId: 'loc',
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 100,
    });
    expect(result.locationId).toBe('loc');
    expect(client.release).toHaveBeenCalled();
  });

  it('storeLocation updates existing location successfully', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'loc' }] }) // existing
        .mockResolvedValueOnce(undefined) // update
        .mockResolvedValueOnce(undefined), // COMMIT
      release: vi.fn(),
    };
    db.getClient.mockResolvedValue(client);

    const result = await oauth.storeLocation(
      {
        locationId: 'loc',
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 100,
      },
      { name: 'Updated Name' }
    );
    expect(result.locationId).toBe('loc');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE locations'),
      expect.any(Array)
    );
  });

  it('storeLocation updates existing and rolls back on error', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ id: 'loc' }] })
        .mockRejectedValueOnce(new Error('upd fail')),
      release: vi.fn(),
    };
    db.getClient.mockResolvedValue(client);
    await expect(
      oauth.storeLocation({
        locationId: 'loc',
        accessToken: 'a',
        refreshToken: 'r',
      })
    ).rejects.toThrow('upd fail');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('storeLocation throws without locationId', async () => {
    await expect(oauth.storeLocation({})).rejects.toThrow(
      'Location ID not found'
    );
  });

  it('completeOAuthFlow validates state and syncs agents', async () => {
    await expect(
      oauth.completeOAuthFlow('c', 'a', 'b')
    ).rejects.toThrow('Invalid state');

    oauthSdk.getAccessToken.mockResolvedValue({
      access_token: 'a12345678',
      refresh_token: 'r12345678',
      expires_in: 3600,
      locationId: 'loc',
    });
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    db.getClient.mockResolvedValue(client);
    listAgents.mockResolvedValue([{ id: 'a1', agentName: 'A' }, { id: 'a2' }]);
    syncAgent
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('sync fail'));

    const result = await oauth.completeOAuthFlow('code', 's', 's');
    expect(result.success).toBe(true);
    expect(result.locationId).toBe('loc');
  });

  it('completeOAuthFlow continues if agent fetch fails', async () => {
    oauthSdk.getAccessToken.mockResolvedValue({
      access_token: 'a12345678',
      refresh_token: 'r12345678',
      locationId: 'loc',
    });
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    db.getClient.mockResolvedValue(client);
    listAgents.mockRejectedValue(new Error('list fail'));
    const result = await oauth.completeOAuthFlow('c', 's', 's');
    expect(result.success).toBe(true);
  });

  it('revokeLocation', async () => {
    db.query.mockResolvedValue({ rowCount: 0 });
    await expect(oauth.revokeLocation('x')).rejects.toThrow('not found');
    db.query.mockResolvedValue({ rowCount: 1 });
    await oauth.revokeLocation('loc');
  });

  it('getInstalledLocations', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          id: 'l1',
          name: 'N',
          token_expires_at: null,
          created_at: 'c',
          updated_at: 'u',
        },
      ],
    });
    const list = await oauth.getInstalledLocations();
    expect(list[0].locationId).toBe('l1');

    db.query.mockRejectedValue(new Error('db'));
    expect(await oauth.getInstalledLocations()).toEqual([]);
  });

  it('isLocationInstalled', async () => {
    db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    expect(await oauth.isLocationInstalled('l')).toBe(true);
    db.query.mockResolvedValue({ rows: [] });
    expect(await oauth.isLocationInstalled('l')).toBe(false);
    db.query.mockRejectedValue(new Error('db'));
    expect(await oauth.isLocationInstalled('l')).toBe(false);
  });
});
