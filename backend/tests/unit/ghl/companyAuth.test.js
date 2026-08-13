import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => `enc:${t}`),
  decrypt: vi.fn((t) => String(t).replace(/^enc:/, '')),
}));

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../src/ghl/oauth.js', () => ({
  storeLocation: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import axios from 'axios';
import { storeLocation } from '../../../src/ghl/oauth.js';
import {
  isCompanyInstall,
  storeCompany,
  ensureLocationFromCompany,
} from '../../../src/ghl/companyAuth.js';

describe('ghl/companyAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects agency installs', () => {
    expect(isCompanyInstall({ userType: 'Company', companyId: 'co-1' })).toBe(true);
    expect(isCompanyInstall({ isBulkInstallation: true, companyId: 'co-1' })).toBe(true);
    expect(isCompanyInstall({ companyId: 'co-1' })).toBe(true);
    expect(isCompanyInstall({ userType: 'Location', locationId: 'loc-1', companyId: 'co-1' })).toBe(false);
  });

  it('stores an agency token', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await storeCompany({
      companyId: 'co-1',
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 60,
      userType: 'Company',
    });
    expect(result.companyId).toBe('co-1');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO companies'),
      expect.any(Array)
    );
  });

  it('skips minting when the location already exists', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'loc-1' }] });
    await expect(ensureLocationFromCompany('co-1', 'loc-1')).resolves.toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('mints a location token from the agency token', async () => {
    const companyRow = {
      access_token: 'enc:agency-token',
      refresh_token: 'enc:refresh',
      token_expires_at: new Date(Date.now() + 10 * 60_000),
    };
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [companyRow] });
    axios.post.mockResolvedValue({
      data: {
        access_token: 'loc-token',
        refresh_token: 'loc-refresh',
        expires_in: 3600,
        locationId: 'loc-1',
        companyId: 'co-1',
        userType: 'Location',
      },
    });

    await expect(ensureLocationFromCompany('co-1', 'loc-1')).resolves.toBe(true);
    expect(storeLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: 'loc-1',
        companyId: 'co-1',
        accessToken: 'loc-token',
      }),
      expect.any(Object)
    );
  });
});
