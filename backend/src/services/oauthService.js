import {
  getAuthorizationUrl as getGHLAuthUrl,
  generateState as generateGHLState,
  completeOAuthFlow as completeGHLOAuthFlow,
  getInstalledLocations as getGHLInstalledLocations,
  revokeLocation as revokeGHLLocation
} from '../ghl/oauth.js';
import { decryptSSOData } from '../utils/sso.js';
import locationService from './locationService.js';
import db from '../db/connection.js';

/**
 * OAuth Service
 * Business logic for OAuth and SSO management
 */

// In-memory state store (TODO: Move to Redis in production)
const stateStore = new Map();
const STATE_MAX_AGE = 10 * 60 * 1000; // 10 minutes

/**
 * Generate OAuth state and store it
 * @returns {string} OAuth state
 */
export function generateState() {
  const state = generateGHLState();

  stateStore.set(state, {
    createdAt: Date.now()
  });

  // Clean up old states
  cleanupExpiredStates();

  return state;
}

/**
 * Validate OAuth state
 * @param {string} state - OAuth state to validate
 * @returns {boolean} True if valid
 */
export function validateState(state) {
  if (!state) return false;

  const stateData = stateStore.get(state);
  if (!stateData) return false;

  // Check if expired
  const age = Date.now() - stateData.createdAt;
  if (age > STATE_MAX_AGE) {
    stateStore.delete(state);
    return false;
  }

  return true;
}

/**
 * Consume OAuth state (validate and remove)
 * @param {string} state - OAuth state to consume
 * @returns {boolean} True if valid and consumed
 */
export function consumeState(state) {
  const isValid = validateState(state);

  if (isValid) {
    stateStore.delete(state);
  }

  return isValid;
}

/**
 * Clean up expired states
 */
function cleanupExpiredStates() {
  const now = Date.now();

  for (const [state, data] of stateStore.entries()) {
    if (now - data.createdAt > STATE_MAX_AGE) {
      stateStore.delete(state);
    }
  }
}

/**
 * Get OAuth authorization URL
 * @returns {Object} Authorization URL and state
 */
export function getAuthorizationUrl() {
  const state = generateState();
  const url = getGHLAuthUrl(state);

  return { url, state };
}

/**
 * Complete OAuth flow and store tokens
 * @param {string} code - OAuth authorization code
 * @param {string} state - OAuth state
 * @returns {Promise<Object>} Location data
 */
export async function completeOAuthFlow(code, state) {
  // Validate state
  if (state && state !== 'no-state' && !consumeState(state)) {
    throw new Error('Invalid or expired state parameter');
  }

  // Exchange code for tokens
  const result = await completeGHLOAuthFlow(code, state, state);

  // The completeGHLOAuthFlow already stores in DB, but we should use our service
  // Return the location data
  return result;
}

/**
 * Decrypt SSO data and link location to company tokens
 * @param {string} encryptedKey - Encrypted SSO key
 * @returns {Promise<Object>} Decrypted SSO data
 */
export async function decryptAndLinkSSO(encryptedKey) {
  if (!encryptedKey) {
    throw new Error('Missing encrypted key');
  }

  console.log('Decrypting SSO data...');
  const decryptedData = decryptSSOData(encryptedKey);

  const { userId, companyId, activeLocation } = decryptedData;

  console.log(`✓ SSO decrypted: userId=${userId}, companyId=${companyId}, activeLocation=${activeLocation}`);

  // If we have a location ID from SSO, link it to company's OAuth tokens
  if (activeLocation && companyId && activeLocation !== companyId) {
    await linkLocationToCompany(activeLocation, companyId);
  }

  return decryptedData;
}

/**
 * Link location to company's OAuth tokens
 * @param {string} locationId - Location ID
 * @param {string} companyId - Company ID
 */
async function linkLocationToCompany(locationId, companyId) {
  try {
    // Check if we have company-level tokens
    const companyLocation = await locationService.getLocationById(companyId);

    if (!companyLocation) {
      console.warn(`⚠️  Company ${companyId} not found in database - OAuth may not be complete`);
      return;
    }

    // Create/update location record with company's tokens
    const existingLocation = await db.query(
      'SELECT * FROM locations WHERE id = $1',
      [locationId]
    );

    if (existingLocation.rows.length > 0) {
      // Update existing location with company tokens
      await locationService.updateLocation(locationId, {
        access_token: companyLocation.access_token,
        refresh_token: companyLocation.refresh_token,
        token_expires_at: companyLocation.token_expires_at
      });
    } else {
      // Create new location with company tokens
      await locationService.createLocation({
        id: locationId,
        name: `Location ${locationId}`,
        access_token: companyLocation.access_token,
        refresh_token: companyLocation.refresh_token,
        token_expires_at: companyLocation.token_expires_at
      });
    }

    console.log(`✓ Linked location ${locationId} to company ${companyId} tokens`);
  } catch (error) {
    console.error('Failed to link location to company tokens:', error);
    // Don't fail the SSO flow if linking fails
  }
}

/**
 * Get all installed locations
 * @returns {Promise<Array>} List of installed locations
 */
export async function getInstalledLocations() {
  return getGHLInstalledLocations();
}

/**
 * Revoke location access
 * @param {string} locationId - Location ID to revoke
 * @returns {Promise<void>}
 */
export async function revokeLocation(locationId) {
  // Revoke in GHL
  await revokeGHLLocation(locationId);

  // Soft delete in our database
  await locationService.deleteLocation(locationId);
}

export default {
  generateState,
  validateState,
  consumeState,
  getAuthorizationUrl,
  completeOAuthFlow,
  decryptAndLinkSSO,
  getInstalledLocations,
  revokeLocation
};
