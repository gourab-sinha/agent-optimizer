import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({
  default: Object.assign(vi.fn(), {
    post: vi.fn(),
  }),
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
  decrypt: vi.fn((t) => String(t).replace(/^enc:/, '')),
}));

import axios from 'axios';
import db from '../../../src/db/connection.js';
import {
  ghl,
  getRequestLog,
  clearRequestLog,
  getRequestStats,
} from '../../../src/ghl/client.js';

describe('ghl/client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRequestLog();
    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:access-token-value-here',
          refresh_token: 'enc:refresh-token',
          token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    });
  });

  it('throws when location not found', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(ghl('missing', 'GET', '/path')).rejects.toThrow(
      'Location missing not found'
    );
  });

  it('performs successful GET request', async () => {
    axios.mockResolvedValue({ status: 200, data: { ok: true } });
    const data = await ghl('loc', 'GET', '/voice-ai/agents', {
      query: { page: 1, empty: null },
    });
    expect(data).toEqual({ ok: true });
    expect(getRequestLog(1)[0].status).toBe(200);
  });

  it('performs POST with body', async () => {
    axios.mockResolvedValue({ status: 201, data: { id: 1 } });
    const data = await ghl('loc', 'POST', '/path', { body: { a: 1 } });
    expect(data.id).toBe(1);
  });

  it('refreshes token when near expiry', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:old-access-token-xxxxxxxx',
          refresh_token: 'enc:refresh',
          token_expires_at: new Date(Date.now() + 10_000).toISOString(),
        },
      ],
    });
    axios.post.mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      },
    });
    axios.mockResolvedValue({ status: 200, data: { ok: 1 } });
    await ghl('loc', 'GET', '/p');
    expect(axios.post).toHaveBeenCalled();
  });

  it('retries once on 401 after refresh', async () => {
    axios
      .mockRejectedValueOnce({
        response: { status: 401, data: { message: 'unauthorized' } },
        message: '401',
      })
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });
    axios.post.mockResolvedValue({
      data: {
        access_token: 'new',
        refresh_token: 'r',
        expires_in: 3600,
      },
    });
    const data = await ghl('loc', 'GET', '/p');
    expect(data.ok).toBe(true);
  });

  it('throws when refresh fails after 401', async () => {
    axios.mockRejectedValue({
      response: { status: 401, data: {} },
      message: '401',
    });
    axios.post.mockRejectedValue(new Error('refresh fail'));
    await expect(ghl('loc', 'GET', '/p')).rejects.toThrow(
      'Authentication failed after token refresh'
    );
  });

  it('retries on 429 then succeeds', async () => {
    axios
      .mockRejectedValueOnce({
        response: { status: 429, data: {} },
        message: 'rate',
      })
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const data = await ghl('loc', 'GET', '/p');
    expect(data.ok).toBe(true);
  }, 20000);

  it('retries on 5xx then succeeds', async () => {
    axios
      .mockRejectedValueOnce({
        response: { status: 500, statusText: 'err', data: {} },
        message: 'server',
      })
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const data = await ghl('loc', 'GET', '/p');
    expect(data.ok).toBe(true);
  }, 20000);

  it('throws GHL API error for other status codes', async () => {
    // Use high _attempt via recursive path by exhausting retries differently:
    // 400 is not retried - mockRejectedValueOnce to avoid leftover mocks
    axios.mockReset();
    axios.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'bad' }, statusText: 'Bad' },
      message: 'bad',
    });
    // re-setup db for this call
    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:access-token-value-here',
          refresh_token: 'enc:refresh-token',
          token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    });
    await expect(ghl('loc', 'GET', '/p-400')).rejects.toThrow('GHL API error (400)');
  });

  it('retries network errors then fails', async () => {
    axios.mockReset();
    axios.mockRejectedValue({ message: 'network', response: undefined });
    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:access-token-value-here',
          refresh_token: 'enc:refresh-token',
          token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    });
    await expect(ghl('loc', 'GET', '/p-net')).rejects.toThrow(
      /GHL API request failed|network/
    );
  }, 30000);

  it('getRequestStats empty and populated', () => {
    expect(getRequestStats()).toEqual({
      total: 0,
      successful: 0,
      failed: 0,
      avgLatency: 0,
    });
  });

  it('getRequestStats after requests', async () => {
    axios.mockResolvedValue({ status: 200, data: {} });
    await ghl('loc', 'GET', '/p');
    const stats = getRequestStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.successful).toBeGreaterThan(0);
    expect(stats.successRate).toBeDefined();
  });
});
