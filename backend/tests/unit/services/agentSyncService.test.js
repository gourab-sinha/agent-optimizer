import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

vi.mock('../../../src/ghl/agents.js', () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { listAgents, getAgent } from '../../../src/ghl/agents.js';
import {
  syncAgent,
  syncAllAgents,
  getAgentConfig,
  getLocationAgents,
  getAgentActions,
  getAgentPrompt,
} from '../../../src/services/agentSyncService.js';

describe('services/agentSyncService', () => {
  beforeEach(() => vi.clearAllMocks());

  const ghlAgent = {
    id: 'agent-1',
    agentName: 'Maya',
    agentPrompt: 'Hello',
    model: 'gpt',
    temperature: 0.5,
    actions: [{ id: 'a1' }],
    voiceId: 'v1',
    language: 'en',
    businessName: 'Biz',
    inboundNumber: '+1',
    timezone: 'UTC',
  };

  it('syncAgent creates baseline version when none exists', async () => {
    getAgent.mockResolvedValue(ghlAgent);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1', name: 'Maya' }] }) // upsert agent
      .mockResolvedValueOnce({ rows: [] }) // latest version empty
      .mockResolvedValueOnce({ rows: [{ id: 'ver-1' }] }); // insert version

    const result = await syncAgent('loc', 'agent-1');
    expect(result.versionCreated).toBe(true);
    expect(result.versionId).toBe('ver-1');
  });

  it('syncAgent reuses version when config unchanged', async () => {
    getAgent.mockResolvedValue(ghlAgent);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'ver-old', config: ghlAgent }],
      });

    const result = await syncAgent('loc', 'agent-1');
    expect(result.versionCreated).toBe(false);
    expect(result.versionId).toBe('ver-old');
  });

  it('syncAgent creates new version when config changes', async () => {
    getAgent.mockResolvedValue(ghlAgent);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'ver-old', config: { agentPrompt: 'Different' } }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'ver-new' }] });

    const result = await syncAgent('loc', 'agent-1');
    expect(result.versionCreated).toBe(true);
    expect(result.versionId).toBe('ver-new');
  });

  it('syncAgent propagates errors', async () => {
    getAgent.mockRejectedValue(new Error('api down'));
    await expect(syncAgent('loc', 'a')).rejects.toThrow('api down');
  });

  it('syncAllAgents syncs, continues on error, marks missing deleted', async () => {
    listAgents.mockResolvedValue([
      { id: 'agent-1' },
      { id: 'agent-2' },
    ]);
    getAgent
      .mockResolvedValueOnce(ghlAgent)
      .mockRejectedValueOnce(new Error('fail agent2'));

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO agents')) {
        return { rows: [{ id: 'agent-1' }] };
      }
      if (sql.includes('FROM agent_versions')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO agent_versions')) {
        return { rows: [{ id: 'v1' }] };
      }
      if (sql.includes('SET is_deleted = true')) {
        return { rows: [{ id: 'old', name: 'Old' }] };
      }
      return { rows: [] };
    });

    const synced = await syncAllAgents('loc');
    expect(synced).toHaveLength(1);
  });

  it('syncAllAgents marks all deleted when HighLevel returns empty', async () => {
    listAgents.mockResolvedValue([]);
    db.query.mockResolvedValue({
      rows: [{ id: 'a', name: 'A' }],
    });
    const synced = await syncAllAgents('loc');
    expect(synced).toEqual([]);
  });

  it('syncAllAgents throws when listAgents fails', async () => {
    listAgents.mockRejectedValue(new Error('list fail'));
    await expect(syncAllAgents('loc')).rejects.toThrow('list fail');
  });

  it('getAgentConfig returns null when missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await getAgentConfig('x')).toBeNull();
    db.query.mockResolvedValue({ rows: [{ id: 'a1' }] });
    expect(await getAgentConfig('a1')).toEqual({ id: 'a1' });
  });

  it('getAgentConfig throws on db error', async () => {
    db.query.mockRejectedValue(new Error('db'));
    await expect(getAgentConfig('a')).rejects.toThrow('db');
  });

  it('getLocationAgents', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 'a1' }] });
    expect(await getLocationAgents('loc')).toHaveLength(1);
    db.query.mockRejectedValue(new Error('db'));
    await expect(getLocationAgents('loc')).rejects.toThrow('db');
  });

  it('getAgentActions', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await getAgentActions('x')).toEqual([]);
    db.query.mockResolvedValue({ rows: [{ actions: [{ id: 1 }] }] });
    expect(await getAgentActions('a')).toEqual([{ id: 1 }]);
    db.query.mockResolvedValue({ rows: [{ actions: null }] });
    expect(await getAgentActions('a')).toEqual([]);
    db.query.mockRejectedValue(new Error('db'));
    await expect(getAgentActions('a')).rejects.toThrow('db');
  });

  it('getAgentPrompt', async () => {
    db.query.mockResolvedValue({ rows: [] });
    expect(await getAgentPrompt('x')).toBeNull();
    db.query.mockResolvedValue({ rows: [{ prompt: 'Hi' }] });
    expect(await getAgentPrompt('a')).toBe('Hi');
    db.query.mockRejectedValue(new Error('db'));
    await expect(getAgentPrompt('a')).rejects.toThrow('db');
  });
});
