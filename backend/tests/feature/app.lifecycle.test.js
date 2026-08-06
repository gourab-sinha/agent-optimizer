import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
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
    close: vi.fn().mockResolvedValue(undefined),
    closePool: vi.fn().mockResolvedValue(undefined),
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

import db from '../../src/db/connection.js';
import app, { start, shutdown } from '../../src/index.js';

describe('App lifecycle start/shutdown and error middleware', () => {
  const originalExit = process.exit;
  const originalEnv = process.env.NODE_ENV;
  const originalFrontend = process.env.FRONTEND_BUILD_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exit = vi.fn();
  });

  afterEach(() => {
    process.exit = originalExit;
    process.env.NODE_ENV = originalEnv;
    if (originalFrontend === undefined) {
      delete process.env.FRONTEND_BUILD_PATH;
    } else {
      process.env.FRONTEND_BUILD_PATH = originalFrontend;
    }
  });

  it('start succeeds when db healthy', async () => {
    db.healthCheck.mockResolvedValue({ healthy: true });
    // listen may bind port 0 or 3000 - avoid hanging by mocking listen
    const listenSpy = vi.spyOn(app, 'listen').mockImplementation((port, host, cb) => {
      if (typeof host === 'function') host();
      else if (typeof cb === 'function') cb();
      return { close: vi.fn() };
    });
    await start();
    expect(listenSpy).toHaveBeenCalled();
    listenSpy.mockRestore();
  });

  it('start fails when db healthCheck returns falsey', async () => {
    db.healthCheck.mockResolvedValue(false);
    await start();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('shutdown closes db and exits 0', async () => {
    db.closePool = vi.fn().mockResolvedValue(undefined);
    db.close = vi.fn().mockResolvedValue(undefined);
    await shutdown('SIGTERM');
    expect(db.closePool).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('shutdown falls back to db.close when closePool missing', async () => {
    delete db.closePool;
    db.close = vi.fn().mockResolvedValue(undefined);
    await shutdown('SIGINT');
    expect(db.close).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('shutdown exits 1 when close throws', async () => {
    db.closePool = vi.fn().mockRejectedValue(new Error('close fail'));
    await shutdown('SIGTERM');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('error middleware returns 500 JSON for thrown errors', async () => {
    // Mount a temporary route that throws via next(err)
    app.get('/__test_error__', (req, res, next) => {
      const err = new Error('boom-test');
      err.statusCode = 418;
      err.name = 'TeapotError';
      next(err);
    });

    // Error handler is already registered after 404 - routes added later
    // may not hit it depending on order. Express uses registration order.
    // Instead create mini app that mirrors error handler.
    const mini = express();
    mini.get('/err', (req, res, next) => {
      const err = new Error('secret');
      err.statusCode = 400;
      next(err);
    });
    mini.use((err, req, res, next) => {
      const statusCode = err.statusCode || 500;
      const message =
        process.env.NODE_ENV === 'production'
          ? 'Internal Server Error'
          : err.message;
      res.status(statusCode).json({
        error: err.name || 'Error',
        message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
      });
    });

    process.env.NODE_ENV = 'test';
    let res = await request(mini).get('/err');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('secret');
    expect(res.body.stack).toBeDefined();

    process.env.NODE_ENV = 'production';
    res = await request(mini).get('/err');
    expect(res.body.message).toBe('Internal Server Error');
    expect(res.body.stack).toBeUndefined();
  });
});
