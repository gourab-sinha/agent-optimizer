import express from 'express';
import { resolveEmbedContext } from '../services/embedContextService.js';

const router = express.Router();

/**
 * POST /api/embed/resolve
 *
 * Called by Agency Custom JS on the Voice AI editor.
 * Binds unsigned AppUtils context (and optional SSO) to an installed
 * location and a Voice AI agent that belongs to that location.
 */
function requestAppBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  return process.env.APP_BASE_URL || (host ? `${proto}://${host}` : '');
}

async function handleResolve(input, req, res) {
  try {
    const result = await resolveEmbedContext({
      ...input,
      appBase: requestAppBase(req),
    });
    const status = result.show ? 200 : 404;
    res.status(status).json({
      success: result.show,
      ...result,
    });
  } catch (error) {
    console.error('Embed resolve failed:', error);
    res.status(500).json({
      success: false,
      show: false,
      reason: 'resolve_failed',
      message: error.message,
    });
  }
}

router.get('/resolve', async (req, res) => {
  await handleResolve({
    companyId: req.query.companyId,
    locationId: req.query.locationId,
    userId: req.query.userId,
    agentId: req.query.agentId,
    agentName: req.query.agentName,
    ssoKey: req.query.ssoKey,
  }, req, res);
});

router.post('/resolve', async (req, res) => {
  await handleResolve(req.body || {}, req, res);
});

export default router;
