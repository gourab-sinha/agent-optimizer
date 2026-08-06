import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/services/locationService.js', () => ({
  default: {
    createLocation: vi.fn(),
    listLocations: vi.fn(),
    getLocationById: vi.fn(),
    getLocationTokens: vi.fn(),
    updateLocation: vi.fn(),
    updateLocationTokens: vi.fn(),
    deleteLocation: vi.fn(),
  },
}));

import locationService from '../../src/services/locationService.js';
import locationRoutes from '../../src/routes/locationRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/locations', locationRoutes);
  return app;
}

describe('Feature: Location routes', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  it('POST /api/locations creates location', async () => {
    locationService.createLocation.mockResolvedValue({ id: 'l1' });
    const res = await request(app)
      .post('/api/locations')
      .send({ id: 'l1', name: 'N', access_token: 'a', refresh_token: 'r' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/locations handles errors', async () => {
    locationService.createLocation.mockRejectedValue(new Error('bad'));
    const res = await request(app).post('/api/locations').send({});
    expect(res.status).toBe(400);
  });

  it('GET /api/locations lists', async () => {
    locationService.listLocations.mockResolvedValue([{ id: 'l1' }]);
    const res = await request(app).get('/api/locations?includeDeleted=true');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('GET /api/locations handles errors', async () => {
    locationService.listLocations.mockRejectedValue(new Error('db'));
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(500);
  });

  it('GET /api/locations/:id', async () => {
    locationService.getLocationById.mockResolvedValue({ id: 'l1' });
    let res = await request(app).get('/api/locations/l1');
    expect(res.status).toBe(200);
    locationService.getLocationById.mockRejectedValue(new Error('not found'));
    res = await request(app).get('/api/locations/x');
    expect(res.status).toBe(404);
  });

  it('GET /api/locations/:id/tokens', async () => {
    locationService.getLocationTokens.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
    });
    let res = await request(app).get('/api/locations/l1/tokens');
    expect(res.status).toBe(200);
    locationService.getLocationTokens.mockRejectedValue(new Error('nf'));
    res = await request(app).get('/api/locations/x/tokens');
    expect(res.status).toBe(404);
  });

  it('PUT update location and tokens', async () => {
    locationService.updateLocation.mockResolvedValue({ id: 'l1' });
    let res = await request(app).put('/api/locations/l1').send({ name: 'n' });
    expect(res.status).toBe(200);
    locationService.updateLocation.mockRejectedValue(new Error('bad'));
    res = await request(app).put('/api/locations/l1').send({});
    expect(res.status).toBe(400);

    locationService.updateLocationTokens.mockResolvedValue({ id: 'l1' });
    res = await request(app)
      .put('/api/locations/l1/tokens')
      .send({ accessToken: 'a', refreshToken: 'r' });
    expect(res.status).toBe(200);
    locationService.updateLocationTokens.mockRejectedValue(new Error('bad'));
    res = await request(app).put('/api/locations/l1/tokens').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE location', async () => {
    locationService.deleteLocation.mockResolvedValue({ id: 'l1' });
    let res = await request(app).delete('/api/locations/l1');
    expect(res.status).toBe(200);
    locationService.deleteLocation.mockRejectedValue(new Error('nf'));
    res = await request(app).delete('/api/locations/x');
    expect(res.status).toBe(404);
  });
});
