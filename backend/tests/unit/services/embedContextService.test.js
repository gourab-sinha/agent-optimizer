import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../../src/utils/sso.js', () => ({
  decryptSSOData: vi.fn(),
}));

vi.mock('../../../src/ghl/agents.js', () => ({
  listAgents: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { decryptSSOData } from '../../../src/utils/sso.js';
import { listAgents } from '../../../src/ghl/agents.js';
import {
  extractAgentIdFromRoute,
  extractLocationIdFromRoute,
  buildEmbedIframeUrl,
  resolveEmbedContext,
} from '../../../src/services/embedContextService.js';

describe('embedContextService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = 'https://optimizer.example.com';
  });

  it('extracts agent and location ids from a HighLevel route', () => {
    expect(extractAgentIdFromRoute({
      params: { agentId: 'agt_12345678' },
    })).toBe('agt_12345678');

    expect(extractAgentIdFromRoute({
      fullPath: '/v2/location/locABC/voice-ai/agent/agtXYZ123',
    })).toBe('agtXYZ123');

    expect(extractLocationIdFromRoute({
      fullPath: '/v2/location/locABC/voice-ai/agent/agtXYZ123',
    })).toBe('locABC');

    expect(extractAgentIdFromRoute({
      fullPath: '/v2/location/6Pba2aO2Pr5z9D4zkMGQ/ai-agents/voice-ai/builder/6a730523fa14242d523f6004',
    })).toBe('6a730523fa14242d523f6004');

    expect(extractLocationIdFromRoute({
      fullPath: '/v2/location/6Pba2aO2Pr5z9D4zkMGQ/ai-agents/voice-ai/builder/6a730523fa14242d523f6004',
    })).toBe('6Pba2aO2Pr5z9D4zkMGQ');
  });

  it('builds an embed iframe URL with agency, location, and agent', () => {
    const url = buildEmbedIframeUrl({
      companyId: 'co-1',
      locationId: 'loc-1',
      agentId: 'agt-1',
      agentName: 'Receptionist',
    });
    expect(url).toContain('https://optimizer.example.com/?');
    expect(url).toContain('embed=1');
    expect(url).toContain('companyId=co-1');
    expect(url).toContain('locationId=loc-1');
    expect(url).toContain('agentId=agt-1');
    expect(buildEmbedIframeUrl({
      locationId: 'loc-1',
      agentId: 'agt-1',
      appBase: 'https://ui.example.com',
    })).toContain('https://ui.example.com/?');
  });

  it('hides the tab when location is missing', async () => {
    await expect(resolveEmbedContext({})).resolves.toMatchObject({
      show: false,
      reason: 'missing_location',
    });
  });

  it('shows a location workspace when the agent id is not in the URL', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'loc-1', name: 'Clinic', company_id: 'co-1', is_deleted: false }],
    });
    const result = await resolveEmbedContext({
      companyId: 'co-1',
      locationId: 'loc-1',
    });
    expect(result.show).toBe(true);
    expect(result.mode).toBe('location');
    expect(result.iframeUrl).toContain('locationId=loc-1');
    expect(result.iframeUrl).not.toContain('agentId=');
  });

  it('hides the tab when the subaccount is not installed', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await resolveEmbedContext({
      companyId: 'co-1',
      locationId: 'loc-1',
      agentId: 'agt-1',
    });
    expect(result).toMatchObject({
      show: false,
      reason: 'location_not_installed',
      companyId: 'co-1',
      locationId: 'loc-1',
    });
  });

  it('hides the tab when the agency does not own the location', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'loc-1', name: 'Clinic', company_id: 'co-other', is_deleted: false }],
    });
    const result = await resolveEmbedContext({
      companyId: 'co-1',
      locationId: 'loc-1',
      agentId: 'agt-1',
    });
    expect(result.show).toBe(false);
    expect(result.reason).toBe('agency_mismatch');
  });

  it('hides the tab when the agent belongs to a different location', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'loc-1', name: 'Clinic', company_id: 'co-1', is_deleted: false }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agt-1', name: 'Other', location_id: 'loc-2' }],
      });

    const result = await resolveEmbedContext({
      companyId: 'co-1',
      locationId: 'loc-1',
      agentId: 'agt-1',
    });
    expect(result.show).toBe(false);
    expect(result.reason).toBe('agent_not_in_location');
  });

  it('shows the tab when SSO, location, and stored agent line up', async () => {
    decryptSSOData.mockReturnValue({
      companyId: 'co-1',
      activeLocation: 'loc-1',
      userId: 'user-9',
    });
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'loc-1', name: 'Clinic', company_id: 'co-1', is_deleted: false }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agt-1', name: 'Receptionist', location_id: 'loc-1' }],
      });

    const result = await resolveEmbedContext({
      ssoKey: 'encrypted',
      agentId: 'agt-1',
    });

    expect(result.show).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.trust).toBe('sso');
    expect(result.companyId).toBe('co-1');
    expect(result.locationId).toBe('loc-1');
    expect(result.userId).toBe('user-9');
    expect(result.agent).toEqual({
      id: 'agt-1',
      name: 'Receptionist',
      locationId: 'loc-1',
    });
    expect(result.iframeUrl).toContain('agentId=agt-1');
    expect(decryptSSOData).toHaveBeenCalledWith('encrypted');
  });

  it('confirms an unsynced agent against the live HighLevel list', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'loc-1', name: 'Clinic', company_id: 'co-1', is_deleted: false }],
      })
      .mockResolvedValueOnce({ rows: [] });
    listAgents.mockResolvedValue([{ id: 'agt-live', agentName: 'Live Agent' }]);

    const result = await resolveEmbedContext({
      companyId: 'co-1',
      locationId: 'loc-1',
      agentId: 'agt-live',
    });

    expect(result.show).toBe(true);
    expect(result.agent.name).toBe('Live Agent');
    expect(listAgents).toHaveBeenCalledWith('loc-1');
  });

  it('prefers SSO activeLocation over unsigned AppUtils values', async () => {
    decryptSSOData.mockReturnValue({
      companyId: 'co-1',
      activeLocation: 'loc-sso',
      userId: 'user-1',
    });
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'loc-sso', name: 'SSO Loc', company_id: 'co-1', is_deleted: false }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agt-1', name: 'A', location_id: 'loc-sso' }],
      });

    const result = await resolveEmbedContext({
      ssoKey: 'enc',
      companyId: 'co-unsigned',
      locationId: 'loc-unsigned',
      agentId: 'agt-1',
    });

    expect(result.locationId).toBe('loc-sso');
    expect(result.companyId).toBe('co-1');
  });
});
