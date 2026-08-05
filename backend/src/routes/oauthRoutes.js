import express from 'express';
import oauth from '../ghl/oauth.js';

const router = express.Router();

// In-memory state store for CSRF protection
// TODO: Move to Redis for production scalability
const stateStore = new Map();

/**
 * OAuth Routes
 * HTTP endpoints for OAuth and SSO management
 */

/**
 * @route   GET /api/oauth/install
 * @desc    Initiate OAuth flow - redirects to HighLevel
 * @access  Public
 */
router.get('/install', (req, res) => {
  try {
    // Generate and store state for CSRF protection
    const state = oauth.generateState();
    stateStore.set(state, { createdAt: Date.now() });

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of stateStore.entries()) {
      if (value.createdAt < tenMinutesAgo) {
        stateStore.delete(key);
      }
    }

    const url = oauth.getAuthorizationUrl(state);

    // Redirect to HighLevel OAuth page
    res.redirect(url);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'OAuth initiation failed',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/oauth/callback
 * @desc    OAuth callback - handles redirect from HighLevel
 * @access  Public
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      throw new Error('Missing code parameter');
    }

    if (!state) {
      throw new Error('Missing state parameter');
    }

    // Validate state (CSRF protection)
    if (!stateStore.has(state)) {
      throw new Error('Invalid state parameter - possible CSRF attack');
    }

    // Remove state after validation (one-time use)
    stateStore.delete(state);

    // Complete OAuth flow
    const result = await oauth.completeOAuthFlow(code, state, state);

    // Show success page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Installation Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              margin: 0;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              color: #333;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              max-width: 500px;
            }
            h1 { color: #4CAF50; margin-bottom: 20px; }
            p { font-size: 16px; margin: 10px 0; }
            .info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Installation Successful</h1>
            <div class="info">
              <p><strong>Location:</strong> ${result.locationName || result.locationId}</p>
            </div>
            <p>You can now close this window.</p>
          </div>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Installation Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
              margin: 0;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              color: #333;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              max-width: 500px;
            }
            h1 { color: #f44336; margin-bottom: 20px; }
            .error { background: #ffebee; color: #c62828; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Installation Failed</h1>
            <div class="error">
              <p>${error.message}</p>
            </div>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * @route   GET /api/oauth/locations
 * @desc    List all installed locations
 * @access  Private
 */
router.get('/locations', async (req, res) => {
  try {
    const locations = await oauth.getInstalledLocations();

    res.json({
      success: true,
      data: locations,
      count: locations.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get locations',
      message: error.message
    });
  }
});

/**
 * @route   DELETE /api/oauth/locations/:locationId
 * @desc    Revoke location access
 * @access  Private
 */
router.delete('/locations/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    await oauth.revokeLocation(locationId);

    res.json({
      success: true,
      message: `Location ${locationId} revoked successfully`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to revoke location',
      message: error.message
    });
  }
});

export default router;
