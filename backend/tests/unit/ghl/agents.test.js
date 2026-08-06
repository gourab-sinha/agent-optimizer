import { describe, it, expect, vi, beforeEach } from 'vitest';

const voiceAiMock = {
  getAgents: vi.fn(),
  getAgent: vi.fn(),
  createAgent: vi.fn(),
  patchAgent: vi.fn(),
  deleteAgent: vi.fn(),
};

vi.mock('../../../src/ghl/sdk-client.js', () => ({
  default: {
    voiceAi: () => voiceAiMock,
    oauth: {},
    locations: {},
  },
}));

import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
} from '../../../src/ghl/agents.js';

describe('ghl/agents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listAgents returns agents array', async () => {
    voiceAiMock.getAgents.mockResolvedValue({ agents: [{ id: 'a1' }] });
    expect(await listAgents('loc')).toEqual([{ id: 'a1' }]);
  });

  it('listAgents returns empty when no agents key', async () => {
    voiceAiMock.getAgents.mockResolvedValue({});
    expect(await listAgents('loc', { query: 'x' })).toEqual([]);
  });

  it('listAgents throws on error', async () => {
    voiceAiMock.getAgents.mockRejectedValue(new Error('fail'));
    await expect(listAgents('loc')).rejects.toThrow('fail');
  });

  it('getAgent returns agent or response', async () => {
    voiceAiMock.getAgent.mockResolvedValue({ agent: { id: 'a1' } });
    expect(await getAgent('loc', 'a1')).toEqual({ id: 'a1' });
    voiceAiMock.getAgent.mockResolvedValue({ id: 'a2' });
    expect(await getAgent('loc', 'a2')).toEqual({ id: 'a2' });
    voiceAiMock.getAgent.mockRejectedValue(new Error('x'));
    await expect(getAgent('loc', 'a')).rejects.toThrow('x');
  });

  it('createAgent / updateAgent / deleteAgent', async () => {
    voiceAiMock.createAgent.mockResolvedValue({ agent: { id: 'n' } });
    expect(await createAgent('loc', { name: 'N' })).toEqual({ id: 'n' });
    voiceAiMock.createAgent.mockRejectedValue(new Error('c'));
    await expect(createAgent('loc', {})).rejects.toThrow('c');

    voiceAiMock.patchAgent.mockResolvedValue({ agent: { id: 'a' } });
    expect(await updateAgent('loc', 'a', { name: 'x' })).toEqual({ id: 'a' });
    voiceAiMock.patchAgent.mockRejectedValue(new Error('u'));
    await expect(updateAgent('loc', 'a', {})).rejects.toThrow('u');

    voiceAiMock.deleteAgent.mockResolvedValue(undefined);
    await deleteAgent('loc', 'a');
    voiceAiMock.deleteAgent.mockRejectedValue(new Error('d'));
    await expect(deleteAgent('loc', 'a')).rejects.toThrow('d');
  });
});
