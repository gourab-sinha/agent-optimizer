import axios from 'axios';
import db from '../db/connection.js';
import { encrypt, decrypt } from '../utils/encryption.js';

// HighLevel API Configuration
const GHL_BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const GHL_VERSION_HEADER = process.env.GHL_VERSION_HEADER || '2021-07-28';
const TOKEN_REFRESH_THRESHOLD = 60 * 1000; // 60 seconds

// Request tracking for logging
const requestLog = [];

/**
 * Core HighLevel API client
 * Handles authentication, token refresh, retries, and rate limiting
 */

/**
 * Load and decrypt location tokens from database
 * @param {string} locationId - GHL location ID
 * @returns {Promise<Object>} Token data
 */
async function loadLocationTokens(locationId) {
  const result = await db.query(
    'SELECT access_token, refresh_token, token_expires_at FROM locations WHERE id = $1',
    [locationId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Location ${locationId} not found`);
  }

  const location = result.rows[0];

  // Decrypt tokens
  const accessToken = decrypt(location.access_token);
  const refreshToken = decrypt(location.refresh_token);

  // Debug: Check token format
  console.log(`[Token Debug] Location: ${locationId}`, {
    accessTokenLength: accessToken.length,
    accessTokenStart: accessToken.substring(0, 20),
    accessTokenEnd: accessToken.slice(-8),
    isJWT: accessToken.startsWith('eyJ')
  });

  return {
    accessToken,
    refreshToken,
    expiresAt: location.token_expires_at ? new Date(location.token_expires_at) : null
  };
}

/**
 * Save encrypted tokens to database
 * @param {string} locationId - GHL location ID
 * @param {Object} tokens - Token data
 */
async function saveLocationTokens(locationId, tokens) {
  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000)
    : null;

  await db.query(
    `UPDATE locations
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [
      encrypt(tokens.accessToken),
      encrypt(tokens.refreshToken),
      expiresAt,
      locationId
    ]
  );
}

/**
 * Check if token needs refresh
 * @param {Date} expiresAt - Token expiration time
 * @returns {boolean} True if refresh needed
 */
function needsRefresh(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt.getTime() - TOKEN_REFRESH_THRESHOLD;
}

/**
 * Refresh OAuth access token
 * @param {string} locationId - GHL location ID
 * @param {string} refreshToken - Current refresh token
 * @returns {Promise<Object>} New tokens
 */
async function refreshAccessToken(locationId, refreshToken) {
  console.log(`Refreshing access token for location: ${locationId}`);

  try {
    const response = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      {
        client_id: process.env.GHL_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokens = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken,
      expiresIn: response.data.expires_in
    };

    await saveLocationTokens(locationId, tokens);

    console.log(`✓ Token refreshed successfully for location: ${locationId}`);
    return tokens;

  } catch (error) {
    console.error('Token refresh failed:', {
      locationId,
      error: error.response?.data || error.message
    });
    throw new Error('Failed to refresh access token');
  }
}

/**
 * Exponential backoff delay
 * @param {number} attempt - Retry attempt number (0-indexed)
 * @returns {Promise<void>}
 */
function backoffDelay(attempt) {
  const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
  console.log(`Retrying after ${delay}ms...`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Main GHL API request function
 * Handles authentication, retries, and error handling
 *
 * @param {string} locationId - GHL location ID
 * @param {string} method - HTTP method
 * @param {string} path - API path (without base URL)
 * @param {Object} options - Request options
 * @param {Object} options.query - Query parameters
 * @param {Object} options.body - Request body
 * @param {number} options._attempt - Internal retry counter
 * @returns {Promise<Object>} API response data
 */
export async function ghl(locationId, method, path, options = {}) {
  const { query = {}, body = null, _attempt = 0 } = options;

  // Load tokens
  let tokens = await loadLocationTokens(locationId);

  // Refresh token if needed
  if (needsRefresh(tokens.expiresAt)) {
    tokens = await refreshAccessToken(locationId, tokens.refreshToken);
  }

  // Build request URL
  const url = new URL(path, GHL_BASE_URL);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  // Build request config
  const config = {
    method,
    url: url.toString(),
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Version': GHL_VERSION_HEADER,
      'Content-Type': 'application/json',
      'locationId': locationId  // Required for company-level OAuth tokens
    }
  };

  if (body) {
    config.data = body;
  }

  // Log request (no bodies or tokens)
  const requestStart = Date.now();
  const logEntry = {
    timestamp: new Date().toISOString(),
    locationId,
    method,
    path,
    attempt: _attempt
  };

  // Debug: Log complete request details
  console.log(`[GHL API] ${method} ${url.toString()}`, {
    locationId,
    headers: {
      Authorization: tokens.accessToken ? `Bearer ***${tokens.accessToken.slice(-8)}` : 'MISSING',
      Version: config.headers.Version,
      locationIdHeader: config.headers.locationId
    },
    queryParams: Object.fromEntries(url.searchParams)
  });

  try {
    const response = await axios(config);
    const latency = Date.now() - requestStart;

    // Log successful request
    logEntry.status = response.status;
    logEntry.latency = latency;
    requestLog.push(logEntry);

    // Log slow requests
    if (latency > 1000) {
      console.warn('Slow GHL API request:', {
        path,
        latency: `${latency}ms`,
        status: response.status
      });
    }

    return response.data;

  } catch (error) {
    const latency = Date.now() - requestStart;
    logEntry.latency = latency;
    logEntry.status = error.response?.status;
    logEntry.error = error.message;
    requestLog.push(logEntry);

    // Handle different error types
    if (error.response) {
      const status = error.response.status;

      // 401 Unauthorized - try token refresh once
      if (status === 401 && _attempt === 0) {
        console.log('Received 401, attempting token refresh...');
        try {
          tokens = await refreshAccessToken(locationId, tokens.refreshToken);
          // Retry request with new token
          return ghl(locationId, method, path, { ...options, _attempt: _attempt + 1 });
        } catch (refreshError) {
          throw new Error('Authentication failed after token refresh');
        }
      }

      // 429 Rate Limited - exponential backoff
      if (status === 429 && _attempt < 3) {
        console.warn('Rate limited by GHL API, retrying...');
        await backoffDelay(_attempt);
        return ghl(locationId, method, path, { ...options, _attempt: _attempt + 1 });
      }

      // 5xx Server Error - retry once
      if (status >= 500 && status < 600 && _attempt === 0) {
        console.warn('GHL API server error, retrying...');
        await backoffDelay(_attempt);
        return ghl(locationId, method, path, { ...options, _attempt: _attempt + 1 });
      }

      // Other errors
      const errorMessage = error.response.data?.message || error.response.statusText;
      throw new Error(`GHL API error (${status}): ${errorMessage}`);
    }

    // Network or other errors
    if (_attempt < 2) {
      console.warn('Network error, retrying...');
      await backoffDelay(_attempt);
      return ghl(locationId, method, path, { ...options, _attempt: _attempt + 1 });
    }

    throw new Error(`GHL API request failed: ${error.message}`);
  }
}

/**
 * Get request log (for debugging and monitoring)
 * @param {number} limit - Number of recent requests to return
 * @returns {Array<Object>} Request log entries
 */
export function getRequestLog(limit = 100) {
  return requestLog.slice(-limit);
}

/**
 * Clear request log
 */
export function clearRequestLog() {
  requestLog.length = 0;
}

/**
 * Get request statistics
 * @returns {Object} Request statistics
 */
export function getRequestStats() {
  if (requestLog.length === 0) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      avgLatency: 0
    };
  }

  const successful = requestLog.filter(r => r.status >= 200 && r.status < 300);
  const failed = requestLog.filter(r => !r.status || r.status >= 400);
  const totalLatency = requestLog.reduce((sum, r) => sum + (r.latency || 0), 0);

  return {
    total: requestLog.length,
    successful: successful.length,
    failed: failed.length,
    avgLatency: Math.round(totalLatency / requestLog.length),
    successRate: ((successful.length / requestLog.length) * 100).toFixed(1) + '%'
  };
}

export default {
  ghl,
  getRequestLog,
  clearRequestLog,
  getRequestStats
};
