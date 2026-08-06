import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/services/callService.js', () => ({
  default: {
    createCall: vi.fn(),
    listCalls: vi.fn(),
    listRealCalls: vi.fn(),
    listSimulatedCalls: vi.fn(),
    getCallById: vi.fn(),
    getCallWithAgent: vi.fn(),
    deleteCall: vi.fn(),
  },
}));

vi.mock('../../src/services/callSyncService.js', () => ({
  syncAgentCalls: vi.fn(),
  getAgentCalls: vi.fn(),
  getAgentCallStats: vi.fn(),
  getLocationCalls: vi.fn(),
}));

import callService from '../../src/services/callService.js';
import * as callSync from '../../src/services/callSyncService.js';
import callRoutes from '../../src/routes/callRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/calls', callRoutes);
  return app;
}

describe('Feature: Call routes', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  it('sync and agent/location call endpoints', async () => {
    let res = await request(app).post('/api/calls/sync-agent/a1').send({});
    expect(res.status).toBe(400);

    callSync.syncAgentCalls.mockResolvedValue([{ id: 'c1' }]);
    res = await request(app)
      .post('/api/calls/sync-agent/a1')
      .send({ locationId: 'l1' });
    expect(res.status).toBe(200);

    callSync.syncAgentCalls.mockRejectedValue(new Error('fail'));
    res = await request(app)
      .post('/api/calls/sync-agent/a1')
      .send({ locationId: 'l1' });
    expect(res.status).toBe(500);

    callSync.getAgentCalls.mockResolvedValue([{ id: 'c1' }]);
    res = await request(app).get('/api/calls/agent/a1?kind=real&limit=1&offset=0');
    expect(res.body.count).toBe(1);
    callSync.getAgentCalls.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/calls/agent/a1');
    expect(res.status).toBe(500);

    callSync.getAgentCallStats.mockResolvedValue({ total_calls: 1 });
    res = await request(app).get('/api/calls/agent/a1/stats');
    expect(res.status).toBe(200);
    callSync.getAgentCallStats.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/calls/agent/a1/stats');
    expect(res.status).toBe(500);

    callSync.getLocationCalls.mockResolvedValue([]);
    res = await request(app).get(
      '/api/calls/location/l1?agentId=a1&kind=real&limit=1&offset=0'
    );
    expect(res.status).toBe(200);
    callSync.getLocationCalls.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/calls/location/l1');
    expect(res.status).toBe(500);
  });

  it('CRUD call endpoints', async () => {
    callService.createCall.mockResolvedValue({ id: 'c1' });
    let res = await request(app).post('/api/calls').send({ id: 'c1', agent_id: 'a1' });
    expect(res.status).toBe(201);
    callService.createCall.mockRejectedValue(new Error('bad'));
    res = await request(app).post('/api/calls').send({});
    expect(res.status).toBe(400);

    callService.listCalls.mockResolvedValue([{ id: 'c1' }]);
    res = await request(app).get('/api/calls?agent_id=a1&kind=real&includeDeleted=true');
    expect(res.body.count).toBe(1);
    callService.listCalls.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/calls');
    expect(res.status).toBe(500);

    callService.listRealCalls.mockResolvedValue([]);
    res = await request(app).get('/api/calls/real');
    expect(res.status).toBe(200);
    callService.listRealCalls.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/calls/real');
    expect(res.status).toBe(500);

    callService.listSimulatedCalls.mockResolvedValue([]);
    res = await request(app).get('/api/calls/simulated');
    expect(res.status).toBe(200);
    callService.listSimulatedCalls.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/calls/simulated');
    expect(res.status).toBe(500);

    callService.getCallById.mockResolvedValue({ id: 'c1' });
    res = await request(app).get('/api/calls/c1');
    expect(res.status).toBe(200);
    callService.getCallById.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/calls/x');
    expect(res.status).toBe(404);

    callService.getCallWithAgent.mockResolvedValue({ id: 'c1', agent: {} });
    res = await request(app).get('/api/calls/c1/with-agent');
    expect(res.status).toBe(200);
    callService.getCallWithAgent.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/calls/x/with-agent');
    expect(res.status).toBe(404);

    callService.deleteCall.mockResolvedValue({ id: 'c1' });
    res = await request(app).delete('/api/calls/c1');
    expect(res.status).toBe(200);
    callService.deleteCall.mockRejectedValue(new Error('nf'));
    res = await request(app).delete('/api/calls/x');
    expect(res.status).toBe(404);
  });
});
