const express = require('express');
const router = express.Router();
const { doc, getDoc } = require('firebase/firestore');
const { initAdmin } = require('../config/firebaseAdmin');
const { getDatabase } = require('../config/database');
const { createToken, consumeToken } = require('../utils/ssoStore');

// Initialize Firebase Admin lazily
const getAdmin = () => initAdmin();

// POST /api/auth/admin/check-reset
// Body: { email: string }
// Verifies whether an email belongs to an authorized admin (via Firebase Auth custom claims,
// ADMIN_EMAILS env allowlist, or Firestore settings/app_config admin email) before allowing
// a password reset from the Admin Console.
router.post('/auth/admin/check-reset', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const normalizedEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, allowed: false, error: 'Email is required' });
    }

    // 1. Check backend ADMIN_EMAILS / VITE_ADMIN_EMAILS env allowlist
    const envAllowlist = String(process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (envAllowlist.includes(normalizedEmail)) {
      return res.json({ success: true, allowed: true });
    }

    // 2. Check Firebase Auth custom claims (admin / super_admin) via Admin SDK
    try {
      const admin = getAdmin();
      const userRecord = await admin.auth().getUserByEmail(normalizedEmail);
      const claims = userRecord?.customClaims || {};
      if (claims.admin === true || claims.super_admin === true) {
        return res.json({ success: true, allowed: true });
      }
      // User exists in Firebase Auth without admin claims -> explicitly not an admin
      return res.json({ success: true, allowed: false });
    } catch (adminErr) {
      if (adminErr?.code === 'auth/user-not-found') {
        return res.json({ success: true, allowed: false });
      }
      console.warn('⚠️ Admin SDK check unavailable for admin password reset, falling back to settings:', adminErr?.message || adminErr);
    }

    // 3. Fallback: check configured admin email in Firestore settings/app_config
    try {
      const db = getDatabase();
      if (db) {
        const snap = await getDoc(doc(db, 'settings', 'app_config'));
        if (snap.exists()) {
          const data = snap.data() || {};
          const configuredAdminEmails = [
            data?.admin_bootstrap?.email,
            data?.welcome_emails?.admin_email,
          ]
            .filter((e) => typeof e === 'string' && e.trim())
            .map((e) => e.trim().toLowerCase());

          if (configuredAdminEmails.includes(normalizedEmail)) {
            return res.json({ success: true, allowed: true });
          }
        }
      }
    } catch (dbErr) {
      console.warn('⚠️ Settings fallback check failed during admin reset check:', dbErr?.message || dbErr);
    }

    return res.json({ success: true, allowed: false });
  } catch (error) {
    console.error('Admin reset eligibility check error:', error);
    return res.status(500).json({ success: false, allowed: false, error: 'Unable to verify admin account' });
  }
});

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