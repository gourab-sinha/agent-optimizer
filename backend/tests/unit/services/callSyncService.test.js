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

vi.mock('../../../src/ghl/calls.js', () => ({
  listCalls: vi.fn(),
  getCall: vi.fn(),
}));

import db from '../../../src/db/connection.js';
import { listCalls } from '../../../src/ghl/calls.js';
import {
  syncAgentCalls,
  getAgentCalls,
  getAgentCallStats,
  getLocationCalls,
} from '../../../src/services/callSyncService.js';

describe('services/callSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue({ rows: [{ id: 'c1' }] });
  });

  it('syncAgentCalls classifies simulated vs real', async () => {
    listCalls.mockResolvedValue([
      {
        id: '1',
        trialCall: true,
        createdAt: '2024-01-01',
        duration: 10,
        transcript: 't',
      },
      {
        id: '2',
        isSimulated: true,
        duration: 5,
      },
      {
        id: '3',
        type: 'test',
        duration: 5,
      },
      {
        id: '4',
        callType: 'simulated',
        duration: 5,
      },
      {
        id: '5',
        duration: 5,
      },
    ]);

    const synced = await syncAgentCalls('loc', 'agent');
    expect(synced).toHaveLength(5);
    expect(listCalls).toHaveBeenCalledWith('loc', {
      agentId: 'agent',
      page: 1,
      pageSize: 50,
    });
    // Verify kind values passed into INSERT
    const kinds = db.query.mock.calls.map((c) => c[1][2]);
    expect(kinds.filter((k) => k === 'simulated')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'real')).toHaveLength(1);
  });

  it('getAgentCalls with and without kind', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await getAgentCalls('a1');
    await getAgentCalls('a1', { kind: 'real', limit: 10, offset: 2 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('getAgentCallStats', async () => {
    db.query.mockResolvedValue({
      rows: [{ total_calls: '1', real_calls: '1' }],
    });
    const stats = await getAgentCallStats('a1');
    expect(stats.total_calls).toBe('1');
  });

  it('getLocationCalls with filters', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await getLocationCalls('loc');
    await getLocationCalls('loc', { agentId: 'a1', kind: 'real', limit: 5, offset: 1 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
