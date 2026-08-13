/**
 * Cache Service
 * Provides caching for frequently accessed data.
 * Gracefully falls back when Redis is not available.
 */

import { cache, isRedisAvailable } from '../infra/redis.js';
import logger from '../infra/logger.js';

// Cache TTLs in seconds
const TTL = {
  AGENT: 300,           // 5 minutes
  AGENT_VERSION: 600,   // 10 minutes
  RUBRIC: 3600,         // 1 hour (rubrics don't change often)
  CALLS: 60,            // 1 minute (calls are synced frequently)
  LOCATION_TOKEN: 300,  // 5 minutes
};

// Cache key prefixes
const PREFIX = {
  AGENT: 'agent:',
  AGENT_VERSION: 'agent_version:',
  RUBRIC: 'rubric:',
  RUBRIC_BY_VERSION: 'rubric_by_version:',
  CALLS: 'calls:',
  LOCATION_TOKEN: 'location_token:',
};

/**
 * Get agent by ID with caching
 */
export async function getCachedAgent(agentId, fetchFn) {
  if (!isRedisAvailable()) {
    return await fetchFn();
  }

  const key = PREFIX.AGENT + agentId;
  const cached = await cache.get(key);

  if (cached) {
    logger.debug('Cache hit', { key });
    return cached;
  }

  const data = await fetchFn();
  if (data) {
    await cache.set(key, data, TTL.AGENT);
  }
  return data;
}

/**
 * Get latest agent version with caching
 */
export async function getCachedAgentVersion(agentId, fetchFn) {
  if (!isRedisAvailable()) {
    return await fetchFn();
  }

  const key = PREFIX.AGENT_VERSION + agentId;
  const cached = await cache.get(key);

  if (cached) {
    logger.debug('Cache hit', { key });
    return cached;
  }

  const data = await fetchFn();
  if (data) {
    await cache.set(key, data, TTL.AGENT_VERSION);
  }
  return data;
}

/**
 * Get rubric by version ID with caching
 */
export async function getCachedRubric(versionId, fetchFn) {
  if (!isRedisAvailable()) {
    return await fetchFn();
  }

  const key = PREFIX.RUBRIC_BY_VERSION + versionId;
  const cached = await cache.get(key);

  if (cached) {
    logger.debug('Cache hit', { key });
    return cached;
  }

  const data = await fetchFn();
  if (data) {
    await cache.set(key, data, TTL.RUBRIC);
  }
  return data;
}

/**
 * Get calls for agent with caching
 */
export async function getCachedCalls(agentId, options, fetchFn) {
  if (!isRedisAvailable()) {
    return await fetchFn();
  }

  const optionsKey = JSON.stringify(options || {});
  const key = `${PREFIX.CALLS}${agentId}:${optionsKey}`;
  const cached = await cache.get(key);

  if (cached) {
    logger.debug('Cache hit', { key });
    return cached;
  }

  const data = await fetchFn();
  if (data) {
    await cache.set(key, data, TTL.CALLS);
  }
  return data;
}

/**
 * Invalidate agent cache
 */
export async function invalidateAgentCache(agentId) {
  if (!isRedisAvailable()) return;

  await Promise.all([
    cache.del(PREFIX.AGENT + agentId),
    cache.del(PREFIX.AGENT_VERSION + agentId),
    cache.invalidatePattern(`${PREFIX.CALLS}${agentId}:*`),
  ]);
  logger.debug('Cache invalidated', { agentId });
}

/**
 * Invalidate rubric cache for a version
 */
export async function invalidateRubricCache(versionId) {
  if (!isRedisAvailable()) return;

  await cache.del(PREFIX.RUBRIC_BY_VERSION + versionId);
  logger.debug('Rubric cache invalidated', { versionId });
}

/**
 * Invalidate calls cache for an agent
 */
export async function invalidateCallsCache(agentId) {
  if (!isRedisAvailable()) return;

  await cache.invalidatePattern(`${PREFIX.CALLS}${agentId}:*`);
  logger.debug('Calls cache invalidated', { agentId });
}

/**
 * Cache wrapper for any function
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function to call on cache miss
 * @param {number} ttl - TTL in seconds
 */
export async function withCache(key, fetchFn, ttl = 300) {
  if (!isRedisAvailable()) {
    return await fetchFn();
  }

  const cached = await cache.get(key);
  if (cached) {
    logger.debug('Cache hit', { key });
    return cached;
  }

  const data = await fetchFn();
  if (data !== null && data !== undefined) {
    await cache.set(key, data, ttl);
  }
  return data;
}

export default {
  getCachedAgent,
  getCachedAgentVersion,
  getCachedRubric,
  getCachedCalls,
  invalidateAgentCache,
  invalidateRubricCache,
  invalidateCallsCache,
  withCache,
  TTL,
  PREFIX,
};
