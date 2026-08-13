import express from 'express';
import locationRoutes from './locationRoutes.js';
import agentRoutes from './agentRoutes.js';
import agentSyncRoutes from './agentSyncRoutes.js';
import callRoutes from './callRoutes.js';
import oauthRoutes from './oauthRoutes.js';
import analysisRoutes from './analysisRoutes.js';
import patternRoutes from './patternRoutes.js';
import testRoutes from './testRoutes.js';
import recommendationRoutes from './recommendations.js';
import optimizeRoutes from './optimizeRoutes.js';
import embedRoutes from './embedRoutes.js';
import webhookRoutes from './webhookRoutes.js';

const router = express.Router();

/**
 * Main API Router
 * All routes are prefixed with /api
 *
 * Routes:
 * - *      /api/oauth/*
 * - *      /api/webhooks/*
 * - *      /api/locations/*
 * - *      /api/agents/*
 * - *      /api/calls/*
 * - *      /api/analysis/*
 * - *      /api/patterns/*
 * - *      /api/tests/*
 */

// OAuth routes
router.use('/oauth', oauthRoutes);
router.use('/embed', embedRoutes);
router.use('/webhooks', webhookRoutes);

// Entity routes
router.use('/locations', locationRoutes);
router.use('/agents', agentRoutes);
router.use('/agents', agentSyncRoutes);
router.use('/calls', callRoutes);

// Analysis routes
router.use('/analysis', analysisRoutes);

// Pattern detection routes
router.use('/patterns', patternRoutes);

// Test case routes
router.use('/tests', testRoutes);

// Recommendation routes
router.use('/recommendations', recommendationRoutes);

// Guided Optimize pipeline
router.use('/optimize', optimizeRoutes);

// 404 handler for API routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl
  });
});

export default router;
