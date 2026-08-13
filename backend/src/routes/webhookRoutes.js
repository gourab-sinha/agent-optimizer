import express from 'express';
import { ensureLocationFromCompany } from '../ghl/companyAuth.js';

const router = express.Router();

/**
 * POST /api/webhooks/ghl
 * HighLevel App Install / Uninstall events.
 * Future subaccounts created under an agency install get a location token here.
 */
router.post('/ghl', async (req, res) => {
  try {
    const body = req.body || {};
    const type = String(body.type || body.event || '').toUpperCase();
    const locationId = body.locationId || body.location_id;
    const companyId = body.companyId || body.company_id;

    if (type === 'INSTALL' && locationId && companyId) {
      await ensureLocationFromCompany(companyId, locationId, body.companyName);
      return res.json({ success: true, action: 'provisioned', locationId, companyId });
    }

    if (type === 'UNINSTALL' && locationId) {
      const db = (await import('../db/connection.js')).default;
      await db.query(
        `UPDATE locations SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
        [locationId]
      );
      return res.json({ success: true, action: 'revoked', locationId });
    }

    res.json({ success: true, action: 'ignored', type });
  } catch (error) {
    console.error('GHL webhook failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
