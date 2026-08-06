import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { ghl, clearRequestLog } from '../../../src/ghl/client.js';

describe('ghl/client slow request logging', () => {
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

  it('logs slow successful requests', async () => {
    const now = Date.now;
    let n = 0;
    Date.now = () => {
      n += 1;
      return n === 1 ? 0 : 1500;
    };
    axios.mockResolvedValue({ status: 200, data: { ok: true } });
    await ghl('loc', 'GET', '/slow');
    Date.now = now;
    expect(axios).toHaveBeenCalled();
  });

  it('handles token without expiry (needsRefresh false path)', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:access-token-value-here',
          refresh_token: 'enc:refresh-token',
          token_expires_at: null,
        },
      ],
    });
    axios.mockResolvedValue({ status: 200, data: { ok: true } });
    const data = await ghl('loc', 'GET', '/no-exp');
    expect(data.ok).toBe(true);
  });

  it('refresh keeps old refresh_token when response omits it', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          access_token: 'enc:old-access-token-xxxxxxxx',
          refresh_token: 'enc:old-refresh',
          token_expires_at: new Date(Date.now() + 5_000).toISOString(),
        },
      ],
    });
    axios.post.mockResolvedValue({
      data: {
        access_token: 'brand-new-access',
        expires_in: 3600,
      },
    });
    axios.mockResolvedValue({ status: 200, data: { ok: 1 } });
    await ghl('loc', 'GET', '/refresh-keep');
    expect(axios.post).toHaveBeenCalled();
  });
});
