import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({
      healthy: true,
      timestamp: new Date(),
      poolSize: 1,
      idleConnections: 1,
      waitingClients: 0,
    }),
    close: vi.fn(),
    closePool: vi.fn(),
    pool: { on: vi.fn(), end: vi.fn() },
  },
}));

// Mock heavy route dependencies so app can load
vi.mock('../../src/ghl/sdk-client.js', () => ({
  default: {
    oauth: {
      getAuthorizationUrl: vi.fn(() => 'https://example.com'),
      getAccessToken: vi.fn(),
    },
    voiceAi: vi.fn(() => ({})),
  },
}));

vi.mock('../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => t),
  decrypt: vi.fn((t) => t),
  hash: vi.fn(),
  compareHash: vi.fn(),
  generateToken: vi.fn(),
  generateEncryptionKey: vi.fn(),
  validateEncryptionKey: vi.fn(),
  default: {
    encrypt: vi.fn((t) => t),
    decrypt: vi.fn((t) => t),
  },
}));

import db from '../../src/db/connection.js';
import app from '../../src/index.js';

describe('Feature: App entry (health, 404, errors)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.healthCheck.mockResolvedValue({
      healthy: true,
      timestamp: new Date(),
      poolSize: 1,
      idleConnections: 1,
      waitingClients: 0,
    });
  });

  it('GET /health returns healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('GET /health returns 503 when db unhealthy', async () => {
    db.healthCheck.mockResolvedValue({ healthy: false, error: 'down' });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
  });

  it('GET /health returns 503 on thrown error', async () => {
    db.healthCheck.mockRejectedValue(new Error('explode'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('explode');
  });

  it('unknown route returns 404 JSON', async () => {
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });

  it('error middleware handles forced test errors', async () => {
    const res = await request(app).get('/__test_error__');
    expect(res.status).toBe(418);
    expect(res.body.error).toBe('TestError');
    expect(res.body.message).toBe('forced test error');
  });
});
