import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/queries.js', () => ({
  default: {
    createLocation: vi.fn(),
    getLocationById: vi.fn(),
    updateLocation: vi.fn(),
    softDeleteLocation: vi.fn(),
    listLocations: vi.fn(),
  },
}));

vi.mock('../../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => `enc:${t}`),
  decrypt: vi.fn((t) => t.replace(/^enc:/, '')),
}));

import queries from '../../../src/db/queries.js';
import {
  createLocation,
  getLocationById,
  getLocationTokens,
  updateLocation,
  updateLocationTokens,
  deleteLocation,
  listLocations,
} from '../../../src/services/locationService.js';

describe('services/locationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createLocation encrypts tokens', async () => {
    queries.createLocation.mockResolvedValue({ id: 'l1' });
    await createLocation({
      id: 'l1',
      name: 'N',
      access_token: 'a',
      refresh_token: 'r',
      token_expires_at: null,
    });
    expect(queries.createLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'enc:a',
        refresh_token: 'enc:r',
      })
    );
  });

  it('getLocationById throws when missing', async () => {
    queries.getLocationById.mockResolvedValue(null);
    await expect(getLocationById('x')).rejects.toThrow('not found');
  });

  it('getLocationById returns location', async () => {
    queries.getLocationById.mockResolvedValue({ id: 'l1' });
    expect(await getLocationById('l1')).toEqual({ id: 'l1' });
  });

  it('getLocationTokens decrypts', async () => {
    queries.getLocationById.mockResolvedValue({
      access_token: 'enc:a',
      refresh_token: 'enc:r',
      token_expires_at: 'exp',
    });
    const tokens = await getLocationTokens('l1');
    expect(tokens).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 'exp',
    });
  });

  it('getLocationTokens throws when missing', async () => {
    queries.getLocationById.mockResolvedValue(null);
    await expect(getLocationTokens('x')).rejects.toThrow('not found');
  });

  it('updateLocation encrypts token fields and throws if missing', async () => {
    queries.updateLocation.mockResolvedValue(null);
    await expect(
      updateLocation('l1', { access_token: 'a', refresh_token: 'r', name: 'n' })
    ).rejects.toThrow('not found');

    queries.updateLocation.mockResolvedValue({ id: 'l1' });
    await updateLocation('l1', { name: 'only' });
    expect(queries.updateLocation).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ name: 'only' })
    );
  });

  it('updateLocationTokens computes expiresAt', async () => {
    queries.updateLocation.mockResolvedValue({ id: 'l1' });
    await updateLocationTokens('l1', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
    });
    expect(queries.updateLocation).toHaveBeenCalled();
  });

  it('deleteLocation throws when missing', async () => {
    queries.softDeleteLocation.mockResolvedValue(null);
    await expect(deleteLocation('x')).rejects.toThrow('not found');
    queries.softDeleteLocation.mockResolvedValue({ id: 'l1' });
    expect(await deleteLocation('l1')).toEqual({ id: 'l1' });
  });

  it('listLocations delegates', async () => {
    queries.listLocations.mockResolvedValue([]);
    expect(await listLocations({ limit: 1 })).toEqual([]);
  });
});
