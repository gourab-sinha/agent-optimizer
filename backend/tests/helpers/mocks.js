/**
 * Shared mock factories for unit and feature tests
 */
import { vi } from 'vitest';

/**
 * Create a mock db module shape matching src/db/connection.js default export
 */
export function createMockDb(overrides = {}) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    getClient: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
    healthCheck: vi.fn().mockResolvedValue({
      healthy: true,
      timestamp: new Date(),
      poolSize: 1,
      idleConnections: 1,
      waitingClients: 0,
    }),
    close: vi.fn().mockResolvedValue(undefined),
    pool: {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      end: vi.fn(),
      query: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
    },
    ...overrides,
  };
}

/**
 * Create mock Express req/res/next for controller unit tests
 */
export function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    },
  };
  return res;
}

export function createMockReq(overrides = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    method: 'GET',
    path: '/',
    originalUrl: '/',
    ...overrides,
  };
}

/**
 * Sample domain fixtures
 */
export const fixtures = {
  location: {
    id: 'loc-1',
    name: 'Test Location',
    access_token: 'encrypted-access',
    refresh_token: 'encrypted-refresh',
    token_expires_at: new Date(Date.now() + 3600_000),
    is_deleted: false,
  },
  agent: {
    id: 'agent-1',
    location_id: 'loc-1',
    name: 'Test Agent',
    sync_cursor: 0,
    config: {
      agentPrompt: 'You are a helpful assistant. Always offer opt-out if requested. TCPA compliance required.',
      welcomeMessage: 'Hello!',
      patienceLevel: 'medium',
      maxCallDuration: 600,
      model: 'gpt-4',
      temperature: 0.7,
      actions: [],
    },
    is_deleted: false,
  },
  call: {
    id: 'call-1',
    agent_id: 'agent-1',
    kind: 'real',
    duration_s: 120,
    summary: 'Caller booked appointment',
    raw_transcript: 'Agent: Hello\nCaller: Hi',
    executed_actions: [],
    extracted_data: {},
    is_deleted: false,
  },
  agentVersion: {
    id: 'av-1',
    agent_id: 'agent-1',
    config: {
      agentPrompt: 'You are a helpful assistant. Always offer opt-out if requested.',
      welcomeMessage: 'Hello!',
      patienceLevel: 'medium',
      maxCallDuration: 600,
    },
    actions: [
      {
        id: 'act-1',
        actionType: 'APPOINTMENT_BOOKING',
        name: 'Book Appointment',
        actionParameters: {},
      },
    ],
    is_deleted: false,
  },
};
