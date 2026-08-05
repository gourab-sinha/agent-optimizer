import { ghl } from './client.js';

/**
 * HighLevel Voice AI Calls API
 * Wrapper functions for call-related API calls
 */

/**
 * List calls for a location
 * @param {string} locationId - GHL location ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of calls
 */
export async function listCalls(locationId, options = {}) {
  try {
    const { limit = 100, skip = 0, agentId, startDate, endDate } = options;

    const query = { limit, skip };
    if (agentId) query.agentId = agentId;
    if (startDate) query.startDate = startDate;
    if (endDate) query.endDate = endDate;

    const response = await ghl(locationId, 'GET', '/voice-ai/dashboard/call-logs', { query });

    console.log(`Fetched ${response.calls?.length || 0} calls for location ${locationId}`);

    return response.calls || [];

  } catch (error) {
    console.error(`Failed to list calls for location ${locationId}:`, error.message);
    throw error;
  }
}

/**
 * Get a specific call by ID
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Call data
 */
export async function getCall(locationId, callId) {
  try {
    const response = await ghl(locationId, 'GET', `/voice-ai/dashboard/call-logs/${callId}`);
    return response.call || response;

  } catch (error) {
    console.error(`Failed to get call ${callId}:`, error.message);
    throw error;
  }
}

/**
 * Get call transcript
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Call transcript
 */
export async function getCallTranscript(locationId, callId) {
  try {
    const response = await ghl(locationId, 'GET', `/v1/voice/calls/${callId}/transcript`);
    return response.transcript || response;

  } catch (error) {
    console.error(`Failed to get transcript for call ${callId}:`, error.message);
    throw error;
  }
}

/**
 * Get call recording URL
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Recording data with URL
 */
export async function getCallRecording(locationId, callId) {
  try {
    const response = await ghl(locationId, 'GET', `/v1/voice/calls/${callId}/recording`);
    return response.recording || response;

  } catch (error) {
    console.error(`Failed to get recording for call ${callId}:`, error.message);
    throw error;
  }
}

/**
 * Get call analytics/metrics
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Call analytics
 */
export async function getCallAnalytics(locationId, callId) {
  try {
    const response = await ghl(locationId, 'GET', `/v1/voice/calls/${callId}/analytics`);
    return response.analytics || response;

  } catch (error) {
    console.error(`Failed to get analytics for call ${callId}:`, error.message);
    throw error;
  }
}

export default {
  listCalls,
  getCall,
  getCallTranscript,
  getCallRecording,
  getCallAnalytics
};
