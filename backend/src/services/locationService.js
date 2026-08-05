import queries from '../db/queries.js';
import { encrypt, decrypt } from '../utils/encryption.js';

/**
 * Location Service
 * Business logic for location management
 */

/**
 * Create a new location
 * @param {Object} data - Location data
 * @returns {Promise<Object>} Created location
 */
export async function createLocation(data) {
  const { id, name, access_token, refresh_token, token_expires_at } = data;

  // Encrypt tokens before storing
  const encryptedAccessToken = encrypt(access_token);
  const encryptedRefreshToken = encrypt(refresh_token);

  const location = await queries.createLocation({
    id,
    name,
    access_token: encryptedAccessToken,
    refresh_token: encryptedRefreshToken,
    token_expires_at
  });

  return location;
}

/**
 * Get location by ID
 * @param {string} id - Location ID
 * @returns {Promise<Object>} Location data
 */
export async function getLocationById(id) {
  const location = await queries.getLocationById(id);

  if (!location) {
    throw new Error(`Location ${id} not found`);
  }

  return location;
}

/**
 * Get location tokens (decrypted)
 * @param {string} id - Location ID
 * @returns {Promise<Object>} Decrypted tokens
 */
export async function getLocationTokens(id) {
  const location = await queries.getLocationById(id);

  if (!location) {
    throw new Error(`Location ${id} not found`);
  }

  return {
    accessToken: decrypt(location.access_token),
    refreshToken: decrypt(location.refresh_token),
    expiresAt: location.token_expires_at
  };
}

/**
 * Update location
 * @param {string} id - Location ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated location
 */
export async function updateLocation(id, data) {
  // Encrypt tokens if being updated
  const updateData = { ...data };

  if (updateData.access_token) {
    updateData.access_token = encrypt(updateData.access_token);
  }

  if (updateData.refresh_token) {
    updateData.refresh_token = encrypt(updateData.refresh_token);
  }

  const location = await queries.updateLocation(id, updateData);

  if (!location) {
    throw new Error(`Location ${id} not found`);
  }

  return location;
}

/**
 * Update location tokens
 * @param {string} id - Location ID
 * @param {Object} tokens - Token data
 * @returns {Promise<Object>} Updated location
 */
export async function updateLocationTokens(id, tokens) {
  const { accessToken, refreshToken, expiresIn } = tokens;

  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  return updateLocation(id, {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: expiresAt
  });
}

/**
 * Soft delete location
 * @param {string} id - Location ID
 * @returns {Promise<Object>} Deleted location
 */
export async function deleteLocation(id) {
  const location = await queries.softDeleteLocation(id);

  if (!location) {
    throw new Error(`Location ${id} not found`);
  }

  return location;
}

/**
 * List locations
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of locations
 */
export async function listLocations(options = {}) {
  return queries.listLocations(options);
}

export default {
  createLocation,
  getLocationById,
  getLocationTokens,
  updateLocation,
  updateLocationTokens,
  deleteLocation,
  listLocations
};
