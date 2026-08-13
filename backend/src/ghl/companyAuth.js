import axios from 'axios';
import db from '../db/connection.js';
import { encrypt, decrypt } from '../utils/encryption.js';

const GHL_BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const GHL_VERSION_HEADER = process.env.GHL_VERSION_HEADER || '2021-07-28';
const GHL_TOKEN_URL = process.env.GHL_TOKEN_URL || 'https://services.leadconnectorhq.com/oauth/token';

function isCompanyUserType(userType) {
  return String(userType || '').toLowerCase() === 'company';
}

export function isCompanyInstall(tokenData = {}) {
  return Boolean(
    isCompanyUserType(tokenData.userType)
    || tokenData.isBulkInstallation
    || (tokenData.companyId && !tokenData.locationId)
  );
}

export async function storeCompany(tokenData, extra = {}) {
  const companyId = tokenData.companyId;
  if (!companyId) {
    throw new Error('Company ID not found in token response');
  }

  const expiresAt = tokenData.expiresIn
    ? new Date(Date.now() + tokenData.expiresIn * 1000)
    : null;

  await db.query(
    `INSERT INTO companies (id, name, access_token, refresh_token, token_expires_at, user_type, is_deleted)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     ON CONFLICT (id) DO UPDATE
     SET name = COALESCE(EXCLUDED.name, companies.name),
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         user_type = COALESCE(EXCLUDED.user_type, companies.user_type),
         is_deleted = false,
         updated_at = NOW()`,
    [
      companyId,
      extra.name || tokenData.companyName || null,
      encrypt(tokenData.accessToken),
      encrypt(tokenData.refreshToken),
      expiresAt,
      tokenData.userType || 'Company',
    ]
  );

  console.log(`✓ Stored agency token for company ${companyId}`);
  return { companyId };
}

async function saveCompanyTokens(companyId, tokens) {
  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000)
    : null;

  await db.query(
    `UPDATE companies
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [
      encrypt(tokens.accessToken),
      encrypt(tokens.refreshToken),
      expiresAt,
      companyId,
    ]
  );
}

export async function loadCompanyTokens(companyId) {
  const result = await db.query(
    `SELECT access_token, refresh_token, token_expires_at
     FROM companies
     WHERE id = $1 AND is_deleted = false`,
    [companyId]
  );

  if (!result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    accessToken: decrypt(row.access_token),
    refreshToken: decrypt(row.refresh_token),
    expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
  };
}

async function refreshCompanyToken(companyId, refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const { data } = await axios.post(GHL_TOKEN_URL, body, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
  await saveCompanyTokens(companyId, tokens);
  return tokens.accessToken;
}

export async function getCompanyAccessToken(companyId) {
  const tokens = await loadCompanyTokens(companyId);
  if (!tokens) return null;

  const expiringSoon = tokens.expiresAt
    && tokens.expiresAt.getTime() - Date.now() < 60 * 1000;

  if (expiringSoon && tokens.refreshToken) {
    try {
      return await refreshCompanyToken(companyId, tokens.refreshToken);
    } catch (error) {
      console.error(`Failed to refresh agency token ${companyId}:`, error.message);
    }
  }

  return tokens.accessToken;
}

function apiVersion() {
  const raw = String(GHL_VERSION_HEADER || '').trim();
  if (!raw || raw.toLowerCase() === 'v3') return '2021-07-28';
  return raw;
}

function ghlHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: apiVersion(),
    Accept: 'application/json',
  };
}

function extractLocationIds(data) {
  const rows = data?.locations || data?.installedLocations || data?.data || [];
  return rows
    .map((row) => row.locationId || row.id || row._id)
    .filter(Boolean);
}

function marketplaceAppId() {
  const raw = String(process.env.GHL_CLIENT_ID || '');
  const hex = raw.match(/^[a-f0-9]{24}/i);
  return hex ? hex[0] : raw;
}

export async function listInstalledLocationIds(companyId) {
  const accessToken = await getCompanyAccessToken(companyId);
  if (!accessToken) return [];

  const baseParams = { companyId };
  const appId = marketplaceAppId();
  if (appId) baseParams.appId = appId;

  const urls = [
    `${GHL_BASE_URL}/oauth/installedLocations`,
  ];

  const ids = [];
  let lastError = null;

  for (const url of urls) {
    try {
      let skip = 0;
      for (;;) {
        const { data } = await axios.get(url, {
          headers: ghlHeaders(accessToken),
          params: { ...baseParams, skip: String(skip) },
        });
        const batch = extractLocationIds(data);
        ids.push(...batch);
        if (!batch.length || batch.length < 20) break;
        skip += batch.length;
        if (skip > 500) break;
      }
      if (ids.length || !lastError) {
        lastError = null;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError && !ids.length) {
    console.error('Failed to list installed locations:', lastError.response?.data || lastError.message);
  }
  return [...new Set(ids)];
}

export async function searchCompanyLocationIds(companyId) {
  const accessToken = await getCompanyAccessToken(companyId);
  if (!accessToken) return [];

  try {
    const { data } = await axios.get(`${GHL_BASE_URL}/locations/search`, {
      headers: ghlHeaders(accessToken),
      params: { companyId, limit: 100 },
    });
    const rows = data.locations || data.data || [];
    return rows
      .map((row) => row.id || row.locationId)
      .filter(Boolean);
  } catch (error) {
    console.error('Failed to search company locations:', error.response?.data || error.message);
    return [];
  }
}

export async function mintLocationToken(companyId, locationId, locationName) {
  const accessToken = await getCompanyAccessToken(companyId);
  if (!accessToken) {
    throw new Error(`No agency token stored for company ${companyId}`);
  }

  const { data } = await axios.post(
    `${GHL_BASE_URL}/oauth/locationToken`,
    new URLSearchParams({ companyId, locationId }),
    {
      headers: {
        ...ghlHeaders(accessToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const { storeLocation } = await import('./oauth.js');
  await storeLocation({
    locationId: data.locationId || locationId,
    companyId: data.companyId || companyId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    userType: data.userType || 'Location',
  }, { name: locationName || data.locationName });

  return data.locationId || locationId;
}

/**
 * If this subaccount is not stored yet, mint a location token from the
 * agency token so every location under the company can use the app.
 */
export async function ensureLocationFromCompany(companyId, locationId, locationName) {
  if (!locationId) return false;

  const existing = await db.query(
    `SELECT id FROM locations WHERE id = $1 AND is_deleted = false`,
    [locationId]
  );
  if (existing.rows[0]) return true;

  if (!companyId) return false;

  const company = await loadCompanyTokens(companyId);
  if (!company) return false;

  await mintLocationToken(companyId, locationId, locationName);
  return true;
}

export async function provisionCompanyLocations(companyId) {
  let ids = await listInstalledLocationIds(companyId);
  if (!ids.length) {
    ids = await searchCompanyLocationIds(companyId);
  }

  const provisioned = [];
  for (const locationId of ids) {
    try {
      await mintLocationToken(companyId, locationId);
      provisioned.push(locationId);
    } catch (error) {
      console.error(`Failed to mint location token for ${locationId}:`, error.response?.data || error.message);
    }
  }

  return provisioned;
}

export default {
  isCompanyInstall,
  storeCompany,
  loadCompanyTokens,
  getCompanyAccessToken,
  listInstalledLocationIds,
  searchCompanyLocationIds,
  mintLocationToken,
  ensureLocationFromCompany,
  provisionCompanyLocations,
};
