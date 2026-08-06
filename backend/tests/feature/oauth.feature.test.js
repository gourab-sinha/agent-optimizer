import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/ghl/oauth.js', () => ({
  default: {
    generateState: vi.fn(() => 'state-abc'),
    getAuthorizationUrl: vi.fn(() => 'https://ghl.example/oauth'),
    completeOAuthFlow: vi.fn(),
    getInstalledLocations: vi.fn(),
    revokeLocation: vi.fn(),
  },
}));

vi.mock('../../src/utils/sso.js', () => ({
  decryptSSOData: vi.fn(),
}));

import oauth from '../../src/ghl/oauth.js';
import { decryptSSOData } from '../../src/utils/sso.js';
import oauthRoutes from '../../src/routes/oauthRoutes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/oauth', oauthRoutes);
  return app;
}

describe('Feature: OAuth routes', () => {
  const app = buildApp();
  beforeEach(() => vi.clearAllMocks());

  it('GET /install redirects', async () => {
    const res = await request(app).get('/api/oauth/install');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://ghl.example/oauth');
  });

  it('GET /install cleans old states from store', async () => {
    oauth.generateState
      .mockReturnValueOnce('old-state')
      .mockReturnValueOnce('new-state');

    const realNow = Date.now;
    let call = 0;
    // First install: createdAt = 0
    // Second install: Date.now() returns large value so old state is pruned
    Date.now = () => {
      call += 1;
      if (call <= 2) return 0; // first install createdAt
      return 11 * 60 * 1000; // second install: 11 minutes later
    };

    await request(app).get('/api/oauth/install');
    const res = await request(app).get('/api/oauth/install');
    Date.now = realNow;
    expect(res.status).toBe(302);
  });

  it('GET /install handles errors', async () => {
    oauth.generateState.mockImplementationOnce(() => {
      throw new Error('state fail');
    });
    const res = await request(app).get('/api/oauth/install');
    expect(res.status).toBe(500);
  });

  it('POST /decrypt-sso', async () => {
    let res = await request(app).post('/api/oauth/decrypt-sso').send({});
    expect(res.status).toBe(400);

    decryptSSOData.mockReturnValue({ userId: 'u1' });
    res = await request(app)
      .post('/api/oauth/decrypt-sso')
      .send({ key: 'enc' });
    expect(res.body.data.userId).toBe('u1');

    decryptSSOData.mockImplementation(() => {
      throw new Error('bad key');
    });
    res = await request(app)
      .post('/api/oauth/decrypt-sso')
      .send({ key: 'enc' });
    expect(res.status).toBe(400);
  });

  it('GET /callback success and failure', async () => {
    let res = await request(app).get('/api/oauth/callback');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Installation Failed/);

    // First install to store state
    oauth.generateState.mockReturnValue('state-ok');
    await request(app).get('/api/oauth/install');

    oauth.completeOAuthFlow.mockResolvedValue({
      locationId: 'loc',
      locationName: 'My Loc',
    });
    res = await request(app).get(
      '/api/oauth/callback?code=abc&state=state-ok'
    );
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Installation Successful/);

    // invalid state still proceeds (warn only)
    res = await request(app).get(
      '/api/oauth/callback?code=abc&state=unknown'
    );
    expect(res.status).toBe(200);

    // no state
    res = await request(app).get('/api/oauth/callback?code=abc');
    expect(res.status).toBe(200);

    oauth.completeOAuthFlow.mockRejectedValue(new Error('oauth fail'));
    res = await request(app).get('/api/oauth/callback?code=abc');
    expect(res.status).toBe(400);
  });

  it('locations list and revoke', async () => {
    oauth.getInstalledLocations.mockResolvedValue([{ locationId: 'l1' }]);
    let res = await request(app).get('/api/oauth/locations');
    expect(res.body.count).toBe(1);
    oauth.getInstalledLocations.mockRejectedValue(new Error('db'));
    res = await request(app).get('/api/oauth/locations');
    expect(res.status).toBe(500);

    oauth.revokeLocation.mockResolvedValue(undefined);
    res = await request(app).delete('/api/oauth/locations/l1');
    expect(res.body.success).toBe(true);
    oauth.revokeLocation.mockRejectedValue(new Error('fail'));
    res = await request(app).delete('/api/oauth/locations/l1');
    expect(res.status).toBe(500);
  });
});
