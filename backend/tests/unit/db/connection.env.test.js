import { describe, it, expect, vi, afterEach } from 'vitest';

describe('db/connection env guard', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('pg');
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db';
  });

  it('throws when DATABASE_URL is missing at import', async () => {
    const saved = process.env.DATABASE_URL;
    vi.resetModules();
    // Prevent dotenv from re-injecting DATABASE_URL from .env
    vi.doMock('dotenv', () => ({
      default: { config: () => ({ parsed: {} }) },
    }));
    vi.doMock('pg', () => ({
      default: {
        Pool: class {
          constructor() {
            this.on = vi.fn();
            this.query = vi.fn();
            this.connect = vi.fn();
            this.end = vi.fn();
            this.totalCount = 0;
            this.idleCount = 0;
            this.waitingCount = 0;
          }
        },
      },
    }));
    delete process.env.DATABASE_URL;

    await expect(import('../../../src/db/connection.js')).rejects.toThrow(
      'DATABASE_URL environment variable is required'
    );

    process.env.DATABASE_URL = saved;
  });
});
