import ghlClient from './sdk-client.js';

/**
 * HighLevel Voice AI Calls API
 * Wrapper functions using official @gohighlevel/api-client SDK
 *
 * API Documentation: https://marketplace.gohighlevel.com/docs/ghl/voice-ai/dashboard
 * Call Logs Endpoint: GET /voice-ai/dashboard/call-logs
 */

/**
 * List calls for a location
 * @param {string} locationId - GHL location ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} List of calls
 */
export async function listCalls(locationId, options = {}) {
  try {
    const {
      page = 1,
      pageSize = 100,
      agentId,
      contactId,
      callType,
      startDate,
      endDate,
      actionType,
      sortBy,
      sort
    } = options;

    const params = {
      page,
      pageSize
    };

    if (agentId) params.agentId = agentId;
    if (contactId) params.contactId = contactId;
    if (callType) params.callType = callType;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    if (actionType) params.actionType = actionType;
    if (sortBy) params.sortBy = sortBy;
    if (sort) params.sort = sort;

    const response = await ghlClient.voiceAi(locationId).getCallLogs(params);

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
    const response = await ghlClient.voiceAi(locationId).getCallLog(callId);
    return response.call || response;

  } catch (error) {
    console.error(`Failed to get call ${callId}:`, error.message);
    throw error;
  }
}

/**
 * Get call transcript
 * Note: This may require a different endpoint not yet available in SDK
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Call transcript
 */
export async function getCallTranscript(locationId, callId) {
  try {
    // First get the call log which may contain transcript
    const call = await getCall(locationId, callId);
    return call.transcript || call;

  } catch (error) {
    console.error(`Failed to get transcript for call ${callId}:`, error.message);
    throw error;
  }
}

/**
 * Get call recording URL
 * Note: This may require a different endpoint not yet available in SDK
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Recording data with URL
 */
export async function getCallRecording(locationId, callId) {
  try {
    // Get call log which may contain recording URL
    const call = await getCall(locationId, callId);
    return call.recording || call;

  } catch (error) {
    console.error(`Failed to get recording for call ${callId}:`, error.message);
    throw error;
  }
}

/**
 * Get call analytics/metrics
 * Note: This may require a different endpoint not yet available in SDK
 * @param {string} locationId - GHL location ID
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} Call analytics
 */
export async function getCallAnalytics(locationId, callId) {
  try {
    // Get call log which may contain analytics
    const call = await getCall(locationId, callId);
    return call.analytics || call;

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
