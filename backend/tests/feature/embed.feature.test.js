import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    close: vi.fn(),
    closePool: vi.fn(),
    pool: { on: vi.fn(), end: vi.fn() },
  },
}));

vi.mock('../../src/ghl/sdk-client.js', () => ({
  default: {
    oauth: {
      getAuthorizationUrl: vi.fn(() => 'https://example.com'),
      getAccessToken: vi.fn(),
    },
    voiceAi: vi.fn(() => ({})),
  },
}));

vi.mock('../../src/ghl/agents.js', () => ({
  listAgents: vi.fn(),
}));

vi.mock('../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => t),
  decrypt: vi.fn((t) => t),
  default: { encrypt: vi.fn((t) => t), decrypt: vi.fn((t) => t) },
}));

import db from '../../src/db/connection.js';
import app from '../../src/index.js';

describe('Feature: embed context resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = 'https://optimizer.example.com';
  });

  it('GET /api/embed/resolve hides the tab without a location', async () => {
    const res = await request(app).get('/api/embed/resolve').query({ agentId: 'agt-1' });
    expect(res.status).toBe(404);
    expect(res.body.show).toBe(false);
    expect(res.body.reason).toBe('missing_location');
  });

  it('POST /api/embed/resolve hides the tab without a location', async () => {
    const res = await request(app).post('/api/embed/resolve').send({ agentId: 'agt-1' });
    expect(res.status).toBe(404);
    expect(res.body.show).toBe(false);
    expect(res.body.reason).toBe('missing_location');
  });

  it('POST /api/embed/resolve shows the tab for a matching agency + location + agent', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'loc-1', name: 'Clinic', company_id: 'co-1', is_deleted: false }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'agt-1', name: 'Receptionist', location_id: 'loc-1' }],
      });

    const res = await request(app).post('/api/embed/resolve').send({
      companyId: 'co-1',
      locationId: 'loc-1',
      agentId: 'agt-1',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.show).toBe(true);
    expect(res.body.companyId).toBe('co-1');
    expect(res.body.agent.id).toBe('agt-1');
    expect(res.body.iframeUrl).toContain('locationId=loc-1');
  });
});
