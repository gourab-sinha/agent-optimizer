import express from 'express';
import locationRoutes from './locationRoutes.js';
import agentRoutes from './agentRoutes.js';
import agentSyncRoutes from './agentSyncRoutes.js';
import callRoutes from './callRoutes.js';
import oauthRoutes from './oauthRoutes.js';

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
 */

// OAuth routes
router.use('/oauth', oauthRoutes);

// Entity routes
router.use('/locations', locationRoutes);
router.use('/agents', agentSyncRoutes);
router.use('/calls', callRoutes);

// 404 handler for API routes
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl
  });
});

export default router;
