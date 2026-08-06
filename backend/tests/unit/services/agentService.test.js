import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/queries.js', () => ({
  default: {
    getLocationById: vi.fn(),
    createAgent: vi.fn(),
    getAgentById: vi.fn(),
    updateAgent: vi.fn(),
    softDeleteAgent: vi.fn(),
    listAgents: vi.fn(),
  },
}));

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

import queries from '../../../src/db/queries.js';
import db from '../../../src/db/connection.js';
import {
  createAgent,
  getAgentById,
  getAgentWithLocation,
  updateAgent,
  updateSyncCursor,
  deleteAgent,
  listAgents,
  listAgentsByLocation,
} from '../../../src/services/agentService.js';

describe('services/agentService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createAgent verifies location exists', async () => {
    queries.getLocationById.mockResolvedValue(null);
    await expect(
      createAgent({ id: 'a', location_id: 'l', name: 'n' })
    ).rejects.toThrow('Location l not found');

    queries.getLocationById.mockResolvedValue({ id: 'l' });
    queries.createAgent.mockResolvedValue({ id: 'a' });
    expect(
      await createAgent({ id: 'a', location_id: 'l', name: 'n' })
    ).toEqual({ id: 'a' });
  });

  it('getAgentById includes latestVersionId', async () => {
    queries.getAgentById.mockResolvedValue(null);
    await expect(getAgentById('x')).rejects.toThrow('not found');

    queries.getAgentById.mockResolvedValue({ id: 'a1', name: 'A' });
    db.query.mockResolvedValue({ rows: [{ id: 'v1' }] });
    expect(await getAgentById('a1')).toEqual({
      id: 'a1',
      name: 'A',
      latestVersionId: 'v1',
    });

    db.query.mockResolvedValue({ rows: [] });
    expect((await getAgentById('a1')).latestVersionId).toBeNull();
  });

  it('getAgentWithLocation', async () => {
    queries.getAgentById.mockResolvedValue(null);
    await expect(getAgentWithLocation('x')).rejects.toThrow('not found');

    queries.getAgentById.mockResolvedValue({ id: 'a1', location_id: 'l1' });
    queries.getLocationById.mockResolvedValue({ id: 'l1' });
    const result = await getAgentWithLocation('a1');
    expect(result.location.id).toBe('l1');
  });

  it('updateAgent / updateSyncCursor / deleteAgent', async () => {
    queries.updateAgent.mockResolvedValue(null);
    await expect(updateAgent('x', { name: 'n' })).rejects.toThrow('not found');

    queries.updateAgent.mockResolvedValue({ id: 'a1', sync_cursor: 5 });
    expect(await updateSyncCursor('a1', 5)).toEqual({
      id: 'a1',
      sync_cursor: 5,
    });

    queries.softDeleteAgent.mockResolvedValue(null);
    await expect(deleteAgent('x')).rejects.toThrow('not found');
    queries.softDeleteAgent.mockResolvedValue({ id: 'a1' });
    expect(await deleteAgent('a1')).toEqual({ id: 'a1' });
  });

  it('listAgents / listAgentsByLocation', async () => {
    queries.listAgents.mockResolvedValue([{ id: 'a1' }]);
    expect(await listAgents()).toEqual([{ id: 'a1' }]);
    await listAgentsByLocation('l1', { limit: 1 });
    expect(queries.listAgents).toHaveBeenCalledWith({
      limit: 1,
      location_id: 'l1',
    });
  });
});
