import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/services/agentService.js', () => ({
  default: {
    createAgent: vi.fn(),
    listAgents: vi.fn(),
    getAgentById: vi.fn(),
    getAgentWithLocation: vi.fn(),
    updateAgent: vi.fn(),
    updateSyncCursor: vi.fn(),
    deleteAgent: vi.fn(),
  },
}));

vi.mock('../../src/services/agentSyncService.js', () => ({
  syncAgent: vi.fn(),
  syncAllAgents: vi.fn(),
  getAgentConfig: vi.fn(),
  getLocationAgents: vi.fn(),
  getAgentActions: vi.fn(),
  getAgentPrompt: vi.fn(),
}));

vi.mock('../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

import agentService from '../../src/services/agentService.js';
import * as agentSync from '../../src/services/agentSyncService.js';
import db from '../../src/db/connection.js';
import agentRoutes from '../../src/routes/agentRoutes.js';
import agentSyncRoutes from '../../src/routes/agentSyncRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentRoutes);
  app.use('/api/agents', agentSyncRoutes);
  return app;
}

describe('Feature: Agent routes', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  it('CRUD agent endpoints', async () => {
    agentService.createAgent.mockResolvedValue({ id: 'a1' });
    let res = await request(app)
      .post('/api/agents')
      .send({ id: 'a1', location_id: 'l', name: 'n' });
    expect(res.status).toBe(201);

    agentService.createAgent.mockRejectedValue(new Error('bad'));
    res = await request(app).post('/api/agents').send({});
    expect(res.status).toBe(400);

    agentService.listAgents.mockResolvedValue([{ id: 'a1' }]);
    res = await request(app).get('/api/agents?location_id=l&includeDeleted=true');
    expect(res.body.count).toBe(1);

    agentService.listAgents.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/agents');
    expect(res.status).toBe(500);

    agentService.getAgentById.mockResolvedValue({ id: 'a1' });
    res = await request(app).get('/api/agents/a1');
    expect(res.status).toBe(200);
    agentService.getAgentById.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/agents/x');
    expect(res.status).toBe(404);

    agentService.getAgentWithLocation.mockResolvedValue({ id: 'a1', location: {} });
    res = await request(app).get('/api/agents/a1/with-location');
    expect(res.status).toBe(200);
    agentService.getAgentWithLocation.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/agents/x/with-location');
    expect(res.status).toBe(404);

    agentService.updateAgent.mockResolvedValue({ id: 'a1' });
    res = await request(app).put('/api/agents/a1').send({ name: 'n2' });
    expect(res.status).toBe(200);
    agentService.updateAgent.mockRejectedValue(new Error('bad'));
    res = await request(app).put('/api/agents/a1').send({});
    expect(res.status).toBe(400);

    agentService.updateSyncCursor.mockResolvedValue({ id: 'a1' });
    res = await request(app)
      .put('/api/agents/a1/sync-cursor')
      .send({ syncCursor: 9 });
    expect(res.status).toBe(200);
    agentService.updateSyncCursor.mockRejectedValue(new Error('bad'));
    res = await request(app).put('/api/agents/a1/sync-cursor').send({});
    expect(res.status).toBe(400);

    agentService.deleteAgent.mockResolvedValue({ id: 'a1' });
    res = await request(app).delete('/api/agents/a1');
    expect(res.status).toBe(200);
    agentService.deleteAgent.mockRejectedValue(new Error('nf'));
    res = await request(app).delete('/api/agents/x');
    expect(res.status).toBe(404);
  });

  it('sync endpoints', async () => {
    let res = await request(app).post('/api/agents/sync/a1').send({});
    expect(res.status).toBe(400);

    agentSync.syncAgent.mockResolvedValue({ id: 'a1' });
    res = await request(app)
      .post('/api/agents/sync/a1')
      .send({ locationId: 'l1' });
    expect(res.status).toBe(200);

    agentSync.syncAgent.mockRejectedValue(new Error('sync fail'));
    res = await request(app)
      .post('/api/agents/sync/a1')
      .send({ locationId: 'l1' });
    expect(res.status).toBe(500);

    db.query.mockResolvedValue({ rows: [] });
    res = await request(app).post('/api/agents/sync-location/missing');
    expect(res.status).toBe(404);

    db.query.mockResolvedValue({ rows: [{ id: 'l1' }] });
    agentSync.syncAllAgents.mockResolvedValue([{ id: 'a1' }]);
    res = await request(app).post('/api/agents/sync-location/l1');
    expect(res.status).toBe(200);

    agentSync.syncAllAgents.mockRejectedValue(new Error('fail'));
    res = await request(app).post('/api/agents/sync-location/l1');
    expect(res.status).toBe(500);
  });

  it('config/actions/prompt/location endpoints', async () => {
    agentSync.getAgentConfig.mockResolvedValue(null);
    let res = await request(app).get('/api/agents/a1/config');
    expect(res.status).toBe(404);
    agentSync.getAgentConfig.mockResolvedValue({ id: 'a1', config: {} });
    res = await request(app).get('/api/agents/a1/config');
    expect(res.status).toBe(200);
    agentSync.getAgentConfig.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/agents/a1/config');
    expect(res.status).toBe(500);

    agentSync.getLocationAgents.mockResolvedValue([{ id: 'a1' }]);
    res = await request(app).get('/api/agents/location/l1');
    expect(res.body.count).toBe(1);
    agentSync.getLocationAgents.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/agents/location/l1');
    expect(res.status).toBe(500);

    agentSync.getAgentActions.mockResolvedValue([]);
    res = await request(app).get('/api/agents/a1/actions');
    expect(res.status).toBe(200);
    agentSync.getAgentActions.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/agents/a1/actions');
    expect(res.status).toBe(500);

    agentSync.getAgentPrompt.mockResolvedValue(null);
    res = await request(app).get('/api/agents/a1/prompt');
    expect(res.status).toBe(404);
    agentSync.getAgentPrompt.mockResolvedValue('Hello');
    res = await request(app).get('/api/agents/a1/prompt');
    expect(res.body.data.prompt).toBe('Hello');
    agentSync.getAgentPrompt.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/agents/a1/prompt');
    expect(res.status).toBe(500);
  });
});
