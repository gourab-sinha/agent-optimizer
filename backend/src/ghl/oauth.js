import db from '../db/connection.js';
import { encrypt } from '../utils/encryption.js';
import ghlClient from './sdk-client.js';

/**
 * HighLevel OAuth 2.0 Flow Implementation
 * Handles marketplace app installation and token management
 * Uses official @gohighlevel/api-client SDK
 */

const CLIENT_ID = process.env.GHL_CLIENT_ID;
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;
const REDIRECT_URI = process.env.GHL_REDIRECT_URI;
const SCOPES = process.env.GHL_SCOPES || 'voice-ai-agents.readonly,voice-ai-agents.write,voice-ai-dashboard.readonly,voice-ai-agent-goals.readonly,voice-ai-agent-goals.write,oauth.readonly,oauth.write,locations.readonly';

/**
 * Generate OAuth authorization URL
 * Redirects user to HighLevel for consent
 *
 * @param {string} state - CSRF protection state parameter
 * @returns {string} Authorization URL
 */
export function getAuthorizationUrl(state) {
  // Use SDK's OAuth module to generate authorization URL
  const url = ghlClient.oauth.getAuthorizationUrl(
    CLIENT_ID,
    REDIRECT_URI,
    SCOPES
  );

  // Add state parameter for CSRF protection
  const urlWithState = state ? `${url}&state=${state}` : url;

  console.log('Generated OAuth URL:', {
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES.split(',')
  });

  return urlWithState;
}

/**
 * Generate random state parameter for CSRF protection
 * @returns {string} Random state string
 */
export function generateState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Exchange authorization code for access token
 *
 * @param {string} code - Authorization code from callback
 * @returns {Promise<Object>} Token response with location info
 */
export async function exchangeCodeForToken(code) {
  try {
    console.log('Exchanging authorization code for tokens...');

    // Use SDK's OAuth module to exchange code for token
    const data = await ghlClient.oauth.getAccessToken({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI
    });

    console.log('✓ Tokens received successfully');
    console.log('\n=== FULL OAUTH TOKEN RESPONSE ===');
    console.log('All available keys:', Object.keys(data));
    console.log('\nDetailed data:');
    console.log(JSON.stringify({
      access_token: data.access_token ? '***' + data.access_token.slice(-8) : null,
      refresh_token: data.refresh_token ? '***' + data.refresh_token.slice(-8) : null,
      expires_in: data.expires_in,
      token_type: data.token_type,
      scope: data.scope,
      locationId: data.locationId,
      companyId: data.companyId,
      userId: data.userId,
      userType: data.userType,
      // Log all other fields that might exist
      ...Object.keys(data).reduce((acc, key) => {
        if (!['access_token', 'refresh_token', 'expires_in', 'token_type', 'scope', 'locationId', 'companyId', 'userId', 'userType'].includes(key)) {
          acc[key] = data[key];
        }
        return acc;
      }, {})
    }, null, 2));
    console.log('=================================\n');

    console.log(`Token class: ${data.userType || (data.locationId ? 'Location' : 'Company')} company=${data.companyId || '-'} location=${data.locationId || '-'}`);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      locationId: data.locationId || null,
      companyId: data.companyId || null,
      userId: data.userId,
      userType: data.userType,
      isBulkInstallation: data.isBulkInstallation === true,
      companyName: data.companyName || null
    };

  } catch (error) {
    console.error('Token exchange failed:', {
      error: error.response?.data || error.message,
      status: error.response?.status
    });

    throw new Error(
      `Failed to exchange authorization code: ${error.response?.data?.error_description || error.message}`
    );
  }
}

/**
 * Store location and tokens in database
 *
 * @param {Object} tokenData - Token data from exchange
 * @param {Object} locationInfo - Additional location information (optional)
 * @returns {Promise<Object>} Stored location record
 */
export async function storeLocation(tokenData, locationInfo = {}) {
  const locationId = tokenData.locationId;

  if (!locationId) {
    throw new Error('Location ID not found in token response');
  }

  const expiresAt = tokenData.expiresIn
    ? new Date(Date.now() + tokenData.expiresIn * 1000)
    : null;

  try {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // Check if location already exists
      const existing = await client.query(
        'SELECT id FROM locations WHERE id = $1',
        [locationId]
      );

      if (existing.rows.length > 0) {
        // Update existing location
        await client.query(
          `UPDATE locations
           SET access_token = $1,
               refresh_token = $2,
               token_expires_at = $3,
               name = COALESCE($4, name),
               company_id = COALESCE($5, company_id),
               user_type = COALESCE($6, user_type),
               updated_at = NOW()
           WHERE id = $7`,
          [
            encrypt(tokenData.accessToken),
            encrypt(tokenData.refreshToken),
            expiresAt,
            locationInfo.name,
            tokenData.companyId || null,
            tokenData.userType || null,
            locationId
          ]
        );

        console.log(`✓ Updated location ${locationId}`);
      } else {
        // Insert new location
        await client.query(
          `INSERT INTO locations (id, name, company_id, user_type, access_token, refresh_token, token_expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            locationId,
            locationInfo.name || 'Unknown Location',
            tokenData.companyId || null,
            tokenData.userType || null,
            encrypt(tokenData.accessToken),
            encrypt(tokenData.refreshToken),
            expiresAt
          ]
        );

        console.log(`✓ Created new location ${locationId}`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      locationId,
      name: locationInfo.name,
      installedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Failed to store location:', error.message);
    throw error;
  }
}

/**
 * Complete OAuth flow - exchange code and store tokens
 * This is the main function called from the OAuth callback endpoint
 *
 * @param {string} code - Authorization code
 * @param {string} state - State parameter for validation
 * @param {string} expectedState - Expected state value
 * @returns {Promise<Object>} Location data
 */
export async function completeOAuthFlow(code, state, expectedState) {
  // Validate state to prevent CSRF
  if (state !== expectedState) {
    throw new Error('Invalid state parameter - possible CSRF attack');
  }

  const tokenData = await exchangeCodeForToken(code);
  const { isCompanyInstall, storeCompany, provisionCompanyLocations } = await import('./companyAuth.js');

  if (isCompanyInstall(tokenData) && tokenData.companyId) {
    await storeCompany(tokenData);
    const locationIds = await provisionCompanyLocations(tokenData.companyId);
    await syncAgentsForLocations(locationIds);
    return {
      success: true,
      companyId: tokenData.companyId,
      locationId: locationIds[0] || null,
      locationName: 'Agency install',
      locationCount: locationIds.length,
      installType: 'company'
    };
  }

  if (!tokenData.locationId) {
    throw new Error('Location ID not found in token response');
  }

  const location = await storeLocation(tokenData);
  await syncAgentsForLocations([location.locationId]);

  return {
    success: true,
    locationId: location.locationId,
    locationName: location.name,
    companyId: tokenData.companyId || null,
    installType: 'location'
  };
}

async function syncAgentsForLocations(locationIds) {
  if (!locationIds?.length) return;
  try {
    const { listAgents } = await import('./agents.js');
    const { syncAgent } = await import('../services/agentSyncService.js');

    for (const locationId of locationIds) {
      try {
        const agentList = await listAgents(locationId);
        console.log(`Fetched ${agentList.length} agents for location ${locationId}`);
        for (const agentSummary of agentList) {
          try {
            await syncAgent(locationId, agentSummary.id);
          } catch (error) {
            console.error(`  ✗ Failed to sync agent ${agentSummary.id}:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch agents for ${locationId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Failed to fetch agents during OAuth:', error.message);
  }
}

/**
 * Revoke location access (uninstall)
 *
 * @param {string} locationId - Location ID to revoke
 * @returns {Promise<void>}
 */
export async function revokeLocation(locationId) {
  try {
    console.log(`Revoking access for location ${locationId}...`);

    // Delete location (CASCADE will handle related records)
    const result = await db.query(
      'DELETE FROM locations WHERE id = $1',
      [locationId]
    );

    if (result.rowCount === 0) {
      throw new Error(`Location ${locationId} not found`);
    }

    console.log(`✓ Location ${locationId} revoked successfully`);

  } catch (error) {
    console.error('Failed to revoke location:', error.message);
    throw error;
  }
}

/**
 * Get all installed locations
 *
 * @returns {Promise<Array>} List of installed locations
 */
export async function getInstalledLocations() {
  try {
    const result = await db.query(
      `SELECT id, name, company_id, user_type, token_expires_at, created_at, updated_at
       FROM locations
       ORDER BY created_at DESC`
    );

    return result.rows.map(row => ({
      locationId: row.id,
      name: row.name,
      companyId: row.company_id,
      userType: row.user_type,
      tokenExpiresAt: row.token_expires_at,
      installedAt: row.created_at,
      lastUpdated: row.updated_at
    }));

  } catch (error) {
    console.error('Failed to get installed locations:', error.message);
    return [];
  }
}

/**
 * Check if a location is installed
 *
 * @param {string} locationId - Location ID
 * @returns {Promise<boolean>} True if installed
 */
export async function isLocationInstalled(locationId) {
  try {
    const result = await db.query(
      'SELECT 1 FROM locations WHERE id = $1',
      [locationId]
    );

    return result.rows.length > 0;
  } catch (error) {
    console.error('Failed to check location installation:', error.message);
    return false;
  }
}

export default {
  getAuthorizationUrl,
  generateState,
  exchangeCodeForToken,
  storeLocation,
  completeOAuthFlow,
  revokeLocation,
  getInstalledLocations,
  isLocationInstalled
};
