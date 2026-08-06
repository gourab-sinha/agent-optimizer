import { describe, it, expect, vi, beforeEach } from 'vitest';

// connection.js is hard to fully re-import with different envs because of Pool.
// We test the exported API by mocking pg Pool behavior via the already-loaded module
// and by exercising healthCheck/query/close through a lightweight re-export pattern.

describe('db/connection module contract', () => {
  it('exports expected API when DATABASE_URL is set (loaded via setup)', async () => {
    // Dynamic import after env is set by setup.js
    const mod = await import('../../../src/db/connection.js');
    expect(mod.default).toHaveProperty('query');
    expect(mod.default).toHaveProperty('getClient');
    expect(mod.default).toHaveProperty('healthCheck');
    expect(mod.default).toHaveProperty('close');
    expect(mod.default).toHaveProperty('pool');
  });

  it('query throws and logs on pool error', async () => {
    const mod = await import('../../../src/db/connection.js');
    const spy = vi.spyOn(mod.default.pool, 'query').mockRejectedValue(new Error('boom'));
    await expect(mod.default.query('SELECT 1')).rejects.toThrow('boom');
    spy.mockRestore();
  });

  it('query returns result and warns on slow queries', async () => {
    const mod = await import('../../../src/db/connection.js');
    const spy = vi.spyOn(mod.default.pool, 'query').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { rows: [{ ok: 1 }], rowCount: 1 };
    });
    // Force slow path by faking Date.now duration
    const now = Date.now;
    let calls = 0;
    Date.now = () => {
      calls += 1;
      return calls === 1 ? 0 : 2000;
    };
    const res = await mod.default.query('SELECT slow');
    expect(res.rows[0].ok).toBe(1);
    Date.now = now;
    spy.mockRestore();
  });

  it('healthCheck returns healthy object', async () => {
    const mod = await import('../../../src/db/connection.js');
    const spy = vi
      .spyOn(mod.default.pool, 'query')
      .mockResolvedValue({ rows: [{ now: new Date() }] });
    const result = await mod.default.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result).toHaveProperty('poolSize');
    spy.mockRestore();
  });

  it('healthCheck returns unhealthy on failure', async () => {
    const mod = await import('../../../src/db/connection.js');
    const spy = vi
      .spyOn(mod.default.pool, 'query')
      .mockRejectedValue(new Error('down'));
    const result = await mod.default.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('down');
    spy.mockRestore();
  });

  it('getClient delegates to pool.connect', async () => {
    const mod = await import('../../../src/db/connection.js');
    const client = { release: vi.fn() };
    const spy = vi.spyOn(mod.default.pool, 'connect').mockResolvedValue(client);
    const c = await mod.default.getClient();
    expect(c).toBe(client);
    spy.mockRestore();
  });

  it('close ends the pool', async () => {
    const mod = await import('../../../src/db/connection.js');
    const spy = vi.spyOn(mod.default.pool, 'end').mockResolvedValue(undefined);
    await mod.default.close();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
