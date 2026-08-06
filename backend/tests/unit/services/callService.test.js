import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/queries.js', () => ({
  default: {
    getAgentById: vi.fn(),
    createCall: vi.fn(),
    getCallById: vi.fn(),
    listCalls: vi.fn(),
    softDelete: vi.fn(),
  },
}));

import queries from '../../../src/db/queries.js';
import {
  createCall,
  getCallById,
  getCallWithAgent,
  listCalls,
  listCallsByAgent,
  listRealCalls,
  listSimulatedCalls,
  deleteCall,
} from '../../../src/services/callService.js';

describe('services/callService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createCall verifies agent', async () => {
    queries.getAgentById.mockResolvedValue(null);
    await expect(
      createCall({ id: 'c1', agent_id: 'a1', kind: 'real' })
    ).rejects.toThrow('Agent a1 not found');

    queries.getAgentById.mockResolvedValue({ id: 'a1' });
    queries.createCall.mockResolvedValue({ id: 'c1' });
    expect(await createCall({ id: 'c1', agent_id: 'a1', kind: 'real' })).toEqual({
      id: 'c1',
    });
  });

  it('getCallById / getCallWithAgent', async () => {
    queries.getCallById.mockResolvedValue(null);
    await expect(getCallById('x')).rejects.toThrow('not found');
    await expect(getCallWithAgent('x')).rejects.toThrow('not found');

    queries.getCallById.mockResolvedValue({ id: 'c1', agent_id: 'a1' });
    queries.getAgentById.mockResolvedValue({ id: 'a1' });
    expect(await getCallById('c1')).toEqual({ id: 'c1', agent_id: 'a1' });
    expect((await getCallWithAgent('c1')).agent.id).toBe('a1');
  });

  it('list helpers', async () => {
    queries.listCalls.mockResolvedValue([]);
    await listCalls();
    await listCallsByAgent('a1', { limit: 1 });
    await listRealCalls();
    await listSimulatedCalls();
    expect(queries.listCalls).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'real' })
    );
    expect(queries.listCalls).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'simulated' })
    );
  });

  it('deleteCall', async () => {
    queries.softDelete.mockResolvedValue(null);
    await expect(deleteCall('x')).rejects.toThrow('not found');
    queries.softDelete.mockResolvedValue({ id: 'c1' });
    expect(await deleteCall('c1')).toEqual({ id: 'c1' });
  });
});
