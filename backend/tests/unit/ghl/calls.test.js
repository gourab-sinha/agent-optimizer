import { describe, it, expect, vi, beforeEach } from 'vitest';

const voiceAiMock = {
  getCallLogs: vi.fn(),
  getCallLog: vi.fn(),
};

vi.mock('../../../src/ghl/sdk-client.js', () => ({
  default: {
    voiceAi: () => voiceAiMock,
  },
}));

import {
  listCalls,
  getCall,
  getCallTranscript,
  getCallRecording,
  getCallAnalytics,
} from '../../../src/ghl/calls.js';

describe('ghl/calls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listCalls maps params and returns callLogs', async () => {
    voiceAiMock.getCallLogs.mockResolvedValue({ callLogs: [{ id: 'c1' }] });
    const calls = await listCalls('loc', {
      agentId: 'a',
      contactId: 'ct',
      callType: 'real',
      startDate: 's',
      endDate: 'e',
      actionType: 'x',
      sortBy: 'date',
      sort: 'desc',
    });
    expect(calls).toEqual([{ id: 'c1' }]);
  });

  it('listCalls returns empty and throws', async () => {
    voiceAiMock.getCallLogs.mockResolvedValue({});
    expect(await listCalls('loc')).toEqual([]);
    voiceAiMock.getCallLogs.mockRejectedValue(new Error('fail'));
    await expect(listCalls('loc')).rejects.toThrow('fail');
  });

  it('getCall and helpers', async () => {
    voiceAiMock.getCallLog.mockResolvedValue({
      call: {
        id: 'c1',
        transcript: 't',
        recording: 'r',
        analytics: { score: 1 },
      },
    });
    expect(await getCall('loc', 'c1')).toMatchObject({ id: 'c1' });
    expect(await getCallTranscript('loc', 'c1')).toBe('t');
    expect(await getCallRecording('loc', 'c1')).toBe('r');
    expect(await getCallAnalytics('loc', 'c1')).toEqual({ score: 1 });

    voiceAiMock.getCallLog.mockRejectedValue(new Error('x'));
    await expect(getCall('loc', 'c')).rejects.toThrow('x');
    await expect(getCallTranscript('loc', 'c')).rejects.toThrow('x');
    await expect(getCallRecording('loc', 'c')).rejects.toThrow('x');
    await expect(getCallAnalytics('loc', 'c')).rejects.toThrow('x');
  });

  it('getCall falls back to full response', async () => {
    voiceAiMock.getCallLog.mockResolvedValue({ id: 'raw' });
    expect(await getCall('loc', 'c')).toEqual({ id: 'raw' });
    // helpers fall back to full object
    expect(await getCallTranscript('loc', 'c')).toEqual({ id: 'raw' });
  });
});
