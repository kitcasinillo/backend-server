const express = require('express');
const router = express.Router();
const { initAdmin } = require('../config/firebaseAdmin');
const { createToken, consumeToken } = require('../utils/ssoStore');

// Initialize Firebase Admin lazily
const getAdmin = () => initAdmin();

// POST /api/auth/sso/init
// Body: { idToken: string }
// Verifies the ID token and issues a short-lived SSO code
router.post('/auth/sso/init', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res.status(400).json({ success: false, error: 'Missing idToken' });
    }

    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    const code = createToken(decoded.uid, 60_000); // 60s TTL
    return res.json({ success: true, code, expiresIn: 60 });
  } catch (error) {
    console.error('SSO init error:', error);
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// POST /api/auth/sso/exchange
// Body: { code: string }
// Exchanges the short-lived code for a Firebase custom token
router.post('/auth/sso/exchange', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ success: false, error: 'Missing code' });
    }

    const uid = consumeToken(code);
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    const admin = getAdmin();
    const customToken = await admin.auth().createCustomToken(uid);
    return res.json({ success: true, customToken });
  } catch (error) {
    console.error('SSO exchange error:', error);
    return res.status(500).json({ success: false, error: 'SSO exchange failed' });
  }
});

module.exports = router;