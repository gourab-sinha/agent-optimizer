import db from '../db/connection.js';
import { decryptSSOData } from '../utils/sso.js';
import { listAgents } from '../ghl/agents.js';

const AGENT_ID_KEYS = ['agentId', 'agent_id', 'id', 'voiceAiAgentId', 'voiceAIAgentId'];

const AGENT_PATH_PATTERNS = [
  /voice-ai\/builder\/([A-Za-z0-9_-]{8,})/i,
  /\/builder\/([A-Za-z0-9_-]{8,})/i,
  /voice-ai(?:-agents)?\/(?:agent\/)?([A-Za-z0-9_-]{8,})/i,
  /ai-agents\/[^/]+\/([A-Za-z0-9_-]{8,})/i,
  /agents\/([A-Za-z0-9_-]{8,})/i,
  /agent\/([A-Za-z0-9_-]{8,})/i,
];

const RESERVED_PATH_SEGMENTS = new Set([
  'edit', 'new', 'create', 'list', 'build', 'builder', 'deploy', 'optimize',
  'voice-ai', 'voiceai', 'ai-agents', 'agents', 'agent',
]);

/**
 * Extract a Voice AI agent id from a HighLevel route object or path string.
 */
export function extractAgentIdFromRoute(route = {}) {
  const params = route.params || {};
  for (const key of AGENT_ID_KEYS) {
    if (params[key] && String(params[key]).length >= 8) {
      return String(params[key]);
    }
  }

  const query = route.query || {};
  if (query.agentId) return String(query.agentId);
  if (query.agent_id) return String(query.agent_id);

  const path = String(route.fullPath || route.path || '').split('?')[0];
  for (const pattern of AGENT_PATH_PATTERNS) {
    const match = path.match(pattern);
    if (match?.[1] && !RESERVED_PATH_SEGMENTS.has(match[1].toLowerCase())) {
      return match[1];
    }
  }

  const last = path.split('/').filter(Boolean).pop() || '';
  if (last.length >= 8 && !RESERVED_PATH_SEGMENTS.has(last.toLowerCase())) {
    return last;
  }

  return '';
}

export function extractLocationIdFromRoute(route = {}) {
  const params = route.params || {};
  if (params.locationId) return String(params.locationId);
  if (params.location_id) return String(params.location_id);

  const path = String(route.fullPath || route.path || '');
  const match = path.match(/\/location\/([A-Za-z0-9]+)/i);
  return match ? match[1] : '';
}

function appBaseUrl(override) {
  return String(override || process.env.APP_BASE_URL || process.env.FRONTEND_URL || '')
    .replace(/\/+$/, '');
}

export function buildEmbedIframeUrl({ companyId, locationId, agentId, agentName, appBase }) {
  const base = appBaseUrl(appBase);
  const params = new URLSearchParams();
  params.set('embed', '1');
  if (locationId) params.set('locationId', locationId);
  if (agentId) params.set('agentId', agentId);
  if (agentName) params.set('agentName', agentName);
  if (companyId) params.set('companyId', companyId);
  return base ? `${base}/?${params.toString()}` : `/?${params.toString()}`;
}

function pickLiveAgent(agents, agentId) {
  if (!Array.isArray(agents)) return null;
  return agents.find((agent) => agent.id === agentId || agent.agentId === agentId) || null;
}

/**
 * Bind Custom JS / iframe context to a known agency + installed subaccount + agent.
 *
 * Trust order:
 *   1. Decrypted SSO (signed by HighLevel with GHL_SHARED_SECRET)
 *   2. AppUtils unsigned fields (company / location / user)
 *   3. Route / URL (agent id — SSO does not include the open agent)
 */
export async function resolveEmbedContext(input = {}) {
  const route = input.route || {};
  const unsigned = {
    companyId: input.companyId || null,
    locationId: input.locationId || extractLocationIdFromRoute(route) || null,
    agentId: input.agentId || extractAgentIdFromRoute(route) || null,
    userId: input.userId || null,
  };

  let sso = null;
  let ssoError = null;
  if (input.ssoKey) {
    try {
      sso = decryptSSOData(input.ssoKey);
    } catch (error) {
      ssoError = error.message;
    }
  }

  const companyId = sso?.companyId || unsigned.companyId || null;
  const locationId = sso?.activeLocation || unsigned.locationId || null;
  const userId = sso?.userId || unsigned.userId || null;
  const agentId = unsigned.agentId || null;
  const trust = sso ? 'sso' : 'unsigned';

  const base = {
    show: false,
    trust,
    companyId,
    locationId,
    userId,
    agentId,
    ssoError,
  };

  if (!locationId) {
    return { ...base, reason: 'missing_location' };
  }

  const locationResult = await db.query(
    `SELECT id, name, company_id, user_type, is_deleted
     FROM locations
     WHERE id = $1`,
    [locationId]
  );
  let location = locationResult.rows[0];

  if (!location || location.is_deleted) {
    if (companyId) {
      try {
        const { ensureLocationFromCompany } = await import('../ghl/companyAuth.js');
        const minted = await ensureLocationFromCompany(companyId, locationId);
        if (minted) {
          const again = await db.query(
            `SELECT id, name, company_id, user_type, is_deleted
             FROM locations
             WHERE id = $1 AND is_deleted = false`,
            [locationId]
          );
          if (again.rows[0]) {
            location = again.rows[0];
          }
        }
      } catch (error) {
        console.error('On-demand location mint failed:', error.response?.data || error.message);
      }
    }

    if (!location || location.is_deleted) {
      return {
        ...base,
        reason: 'location_not_installed',
      };
    }
  }

  if (companyId && location.company_id && location.company_id !== companyId) {
    return {
      ...base,
      reason: 'agency_mismatch',
      installedCompanyId: location.company_id,
    };
  }

  const resolvedCompanyId = companyId || location.company_id || null;

  if (!agentId) {
    return {
      show: true,
      reason: 'ok',
      mode: 'location',
      trust,
      companyId: resolvedCompanyId,
      locationId,
      locationName: location.name,
      userId,
      agentId: null,
      agent: null,
      iframeUrl: buildEmbedIframeUrl({
        companyId: resolvedCompanyId,
        locationId,
        appBase: input.appBase,
      }),
    };
  }

  const agentResult = await db.query(
    `SELECT id, name, location_id
     FROM agents
     WHERE id = $1 AND is_deleted = false`,
    [agentId]
  );
  const storedAgent = agentResult.rows[0];

  if (storedAgent && storedAgent.location_id !== locationId) {
    return {
      ...base,
      companyId: resolvedCompanyId,
      reason: 'agent_not_in_location',
      agentLocationId: storedAgent.location_id,
    };
  }

  let agentName = storedAgent?.name || input.agentName || null;

  if (!storedAgent) {
    try {
      const liveAgents = await listAgents(locationId);
      const live = pickLiveAgent(liveAgents, agentId);
      if (!live) {
        return {
          ...base,
          companyId: resolvedCompanyId,
          reason: 'agent_not_found',
        };
      }
      agentName = live.agentName || live.name || agentName;
    } catch (error) {
      return {
        ...base,
        companyId: resolvedCompanyId,
        reason: 'agent_lookup_failed',
        message: error.message,
      };
    }
  }

  const agent = {
    id: agentId,
    name: agentName || 'Voice AI Agent',
    locationId,
  };

  return {
    show: true,
    reason: 'ok',
    trust,
    companyId: resolvedCompanyId,
    locationId,
    locationName: location.name,
    userId,
    agentId,
    agent,
    iframeUrl: buildEmbedIframeUrl({
      companyId: resolvedCompanyId,
      locationId,
      agentId,
      agentName: agent.name,
      appBase: input.appBase,
    }),
  };
}

export default {
  extractAgentIdFromRoute,
  extractLocationIdFromRoute,
  buildEmbedIframeUrl,
  resolveEmbedContext,
};
