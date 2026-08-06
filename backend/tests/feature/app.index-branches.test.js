import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    close: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../src/utils/encryption.js', () => ({
  encrypt: vi.fn((t) => t),
  decrypt: vi.fn((t) => t),
  default: { encrypt: vi.fn((t) => t), decrypt: vi.fn((t) => t) },
}));

import app from '../../src/index.js';
import db from '../../src/db/connection.js';

describe('index.js remaining middleware branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.healthCheck.mockResolvedValue({ healthy: true });
  });

  it('api 404 for unknown /api path', async () => {
    const res = await request(app).get('/api/totally-unknown-endpoint-xyz');
    expect(res.status).toBe(404);
    // either app-level or router-level 404
    expect(res.body.error || res.body.success === false).toBeTruthy();
  });
});
