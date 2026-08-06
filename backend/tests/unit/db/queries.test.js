import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection.js', () => ({
  default: {
    query: vi.fn(),
    getClient: vi.fn(),
    healthCheck: vi.fn(),
    close: vi.fn(),
    pool: {},
  },
}));

import db from '../../../src/db/connection.js';
import queries from '../../../src/db/queries.js';

describe('db/queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue({ rows: [{ id: '1' }], rowCount: 1 });
  });

  describe('locations', () => {
    it('createLocation', async () => {
      await queries.createLocation({
        id: 'l1',
        name: 'N',
        access_token: 'a',
        refresh_token: 'r',
        token_expires_at: null,
      });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO locations'),
        expect.arrayContaining(['l1', 'N'])
      );
    });

    it('getLocationById', async () => {
      await queries.getLocationById('l1');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM locations'),
        ['l1']
      );
    });

    it('updateLocation builds SET clause', async () => {
      await queries.updateLocation('l1', { name: 'New', access_token: 't' });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE locations'),
        expect.arrayContaining(['New', 't', 'l1'])
      );
    });

    it('updateLocation throws when no fields', async () => {
      await expect(queries.updateLocation('l1', {})).rejects.toThrow(
        'No fields to update'
      );
    });

    it('softDeleteLocation and deleteLocation', async () => {
      await queries.softDeleteLocation('l1');
      await queries.deleteLocation('l1');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('is_deleted = true'),
        ['l1']
      );
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM locations'),
        ['l1']
      );
    });

    it('listLocations with and without deleted', async () => {
      await queries.listLocations();
      await queries.listLocations({ includeDeleted: true, limit: 10, offset: 5 });
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('agents', () => {
    it('create/get/update/softDelete/list agents', async () => {
      await queries.createAgent({
        id: 'a1',
        location_id: 'l1',
        name: 'Agent',
      });
      await queries.getAgentById('a1');
      await queries.updateAgent('a1', { name: 'N2' });
      await expect(queries.updateAgent('a1', {})).rejects.toThrow(
        'No fields to update'
      );
      await queries.softDeleteAgent('a1');
      await queries.listAgents();
      await queries.listAgents({
        location_id: 'l1',
        includeDeleted: true,
        limit: 5,
        offset: 0,
      });
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('calls', () => {
    it('createCall / getCallById / listCalls', async () => {
      await queries.createCall({
        id: 'c1',
        agent_id: 'a1',
        agent_version_id: null,
        kind: 'real',
        test_run_id: null,
        created_at_ghl: new Date().toISOString(),
        duration_s: 10,
        summary: 's',
        raw_transcript: 't',
      });
      await queries.getCallById('c1');
      await queries.listCalls();
      await queries.listCalls({
        agent_id: 'a1',
        kind: 'real',
        includeDeleted: true,
      });
      expect(db.query).toHaveBeenCalled();
    });
  });

  describe('generic CRUD', () => {
    it('create/read/update/softDelete/hardDelete/list', async () => {
      await queries.create('locations', { id: 'x', name: 'n' });
      await queries.read('locations', 'x');
      await queries.update('locations', 'x', { name: 'n2' });
      await expect(queries.update('locations', 'x', {})).rejects.toThrow(
        'No fields to update'
      );
      await queries.softDelete('locations', 'x');
      await queries.hardDelete('locations', 'x');
      await queries.list('locations');
      await queries.list('locations', {
        includeDeleted: true,
        orderBy: 'id ASC',
      });
      expect(db.query).toHaveBeenCalled();
    });
  });
});
