import { HighLevel, SessionStorage } from '@gohighlevel/api-client';
import db from '../db/connection.js';
import { decrypt, encrypt } from '../utils/encryption.js';

/**
 * PostgreSQL Session Storage for HighLevel SDK
 * Extends the SDK's SessionStorage class to store tokens in PostgreSQL
 */
class PostgreSQLSessionStorage extends SessionStorage {
  constructor() {
    super();
    this.clientId = null;
  }

  setClientId(clientId) {
    this.clientId = clientId;
  }

  async init() {
    // Database already initialized via db/connection.js
    console.log('PostgreSQL session storage initialized');
  }

  async disconnect() {
    // Connection managed externally
  }

  async createCollection(collectionName) {
    // PostgreSQL tables already exist
  }

  async getCollection(collectionName) {
    // Return collection name (not used in our implementation)
    return collectionName;
  }

  async setSession(resourceId, sessionData) {
    try {
      const expiresAt = sessionData.expires_at
        ? new Date(sessionData.expires_at)
        : new Date(Date.now() + (sessionData.expires_in || 86400) * 1000);

      await db.query(
        `INSERT INTO locations (id, access_token, refresh_token, token_expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET access_token = $2,
             refresh_token = $3,
             token_expires_at = $4,
             updated_at = NOW()`,
        [
          resourceId,
          encrypt(sessionData.access_token),
          encrypt(sessionData.refresh_token),
          expiresAt
        ]
      );

      console.log(`Stored session for resource ${resourceId}`);
    } catch (error) {
      console.error('Failed to store session:', error.message);
      throw error;
    }
  }

  async getSession(resourceId) {
    try {
      const result = await db.query(
        `SELECT access_token, refresh_token, token_expires_at
         FROM locations
         WHERE id = $1 AND is_deleted = false`,
        [resourceId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        access_token: decrypt(row.access_token),
        refresh_token: decrypt(row.refresh_token),
        expires_at: row.token_expires_at ? new Date(row.token_expires_at).getTime() : null,
        resourceId: resourceId
      };
    } catch (error) {
      console.error('Failed to retrieve session:', error.message);
      return null;
    }
  }

  async deleteSession(resourceId) {
    try {
      await db.query(
        `UPDATE locations SET is_deleted = true WHERE id = $1`,
        [resourceId]
      );
      console.log(`Deleted session for resource ${resourceId}`);
    } catch (error) {
      console.error('Failed to delete session:', error.message);
      throw error;
    }
  }

  async getAccessToken(resourceId) {
    const session = await this.getSession(resourceId);
    return session ? session.access_token : null;
  }

  async getRefreshToken(resourceId) {
    const session = await this.getSession(resourceId);
    return session ? session.refresh_token : null;
  }

  async getSessionsByApplication() {
    // Optional: return all sessions for this application
    try {
      const result = await db.query(
        `SELECT id as resourceId, access_token, refresh_token, token_expires_at
         FROM locations
         WHERE is_deleted = false`
      );

      return result.rows.map(row => ({
        access_token: decrypt(row.access_token),
        refresh_token: decrypt(row.refresh_token),
        expires_at: row.token_expires_at ? new Date(row.token_expires_at).getTime() : null,
        resourceId: row.resourceid
      }));
    } catch (error) {
      console.error('Failed to get sessions:', error.message);
      return [];
    }
  }
}

/**
 * HighLevel SDK Client
 * Wrapper around official @gohighlevel/api-client SDK
 *
 * Uses PostgreSQL for token storage and automatic token management
 */
class GHLClient {
  constructor() {
    this.clientId = process.env.GHL_CLIENT_ID;
    this.clientSecret = process.env.GHL_CLIENT_SECRET;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('GHL_CLIENT_ID and GHL_CLIENT_SECRET must be set in environment variables');
    }

    // Initialize SDK with PostgreSQL session storage
    this.sdk = new HighLevel({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      sessionStorage: new PostgreSQLSessionStorage()
    });
  }

  /**
   * Get Voice AI service
   * @param {string} locationId - Location ID for token retrieval
   * @returns {Object} Voice AI service with configured headers
   */
  voiceAi(locationId) {
    // Return SDK's voiceAi service with locationId in headers
    return {
      // Agents
      getAgents: (params = {}) => this.sdk.voiceAi.getAgents(
        { locationId, ...params },
        { headers: { locationId } }
      ),

      getAgent: (agentId) => this.sdk.voiceAi.getAgent(
        { agentId, locationId },
        { headers: { locationId } }
      ),

      createAgent: (agentData) => this.sdk.voiceAi.createAgent(
        agentData,
        { headers: { locationId } }
      ),

      patchAgent: (agentId, updates) => this.sdk.voiceAi.patchAgent(
        { agentId, locationId },
        updates,
        { headers: { locationId } }
      ),

      deleteAgent: (agentId) => this.sdk.voiceAi.deleteAgent(
        { agentId, locationId },
        { headers: { locationId } }
      ),

      // Call Logs
      getCallLogs: (params = {}) => this.sdk.voiceAi.getCallLogs(
        { locationId, ...params },
        { headers: { locationId } }
      ),

      getCallLog: (callId) => this.sdk.voiceAi.getCallLog(
        { callId, locationId },
        { headers: { locationId } }
      ),

      // Actions
      getAction: (actionId) => this.sdk.voiceAi.getAction(
        { actionId, locationId },
        { headers: { locationId } }
      ),

      createAction: (actionData) => this.sdk.voiceAi.createAction(
        actionData,
        { headers: { locationId } }
      ),

      updateAction: (actionId, updates) => this.sdk.voiceAi.updateAction(
        { actionId },
        updates,
        { headers: { locationId } }
      ),

      deleteAction: (actionId, agentId) => this.sdk.voiceAi.deleteAction(
        { actionId, locationId, agentId },
        { headers: { locationId } }
      )
    };
  }

  /**
   * Get OAuth service
   */
  get oauth() {
    return this.sdk.oauth;
  }

  /**
   * Get locations service
   */
  get locations() {
    return this.sdk.locations;
  }
}

// Export singleton instance
const ghlClient = new GHLClient();

export default ghlClient;
export { ghlClient, PostgreSQLSessionStorage, GHLClient };
