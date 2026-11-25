const {
  getStripe,
  getStripeMode,
  getStripePublishableKey,
  getStripeSecretKey,
  getStripeWebhookSecret,
  getStripeSource,
  reloadStripeWithConfig,
} = require('../config/stripe');
const { initAdmin } = require('../config/firebaseAdmin');
const { getDatabase } = require('../config/database');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { encryptSecret, decryptSecret, maskSecret } = require('../utils/secretCrypto');
const {
  loadHealerSubscriptionConfig,
  syncStripeSubscriptionPrice,
} = require('./subscriptionController');

const STRIPE_SECRETS_DOC = 'stripe_secrets';
const SETTINGS_COLLECTION = 'settings';

const readStripeSecretsDoc = async () => {
  try {
    const admin = initAdmin();
    if (admin) {
      const snap = await admin.firestore().collection(SETTINGS_COLLECTION).doc(STRIPE_SECRETS_DOC).get();
      return snap.exists ? snap.data() : null;
    }
  } catch (_) {
    // fallback to client SDK
  }
  const db = getDatabase();
  if (!db) return null;
  const snap = await getDoc(doc(db, SETTINGS_COLLECTION, STRIPE_SECRETS_DOC));
  return snap.exists() ? snap.data() : null;
};

const writeStripeSecretsDoc = async (payload) => {
  try {
    const admin = initAdmin();
    if (admin) {
      await admin.firestore().collection(SETTINGS_COLLECTION).doc(STRIPE_SECRETS_DOC).set(payload, { merge: true });
      return;
    }
  } catch (_) {
    // fallback to client SDK
  }
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');
  await setDoc(doc(db, SETTINGS_COLLECTION, STRIPE_SECRETS_DOC), payload, { merge: true });
};

/**
 * Middleware: verify Firebase Admin ID token & admin/super_admin claim
 */
const verifyAdminToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Missing Authorization Bearer token' });
    }
    const token = authHeader.slice(7).trim();
    const admin = initAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    const isAdmin = decoded.admin === true || decoded.super_admin === true;
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: 'Admin privileges required' });
    }
    req.adminUser = {
      uid: decoded.uid,
      email: decoded.email || null,
      super_admin: decoded.super_admin === true,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired admin token' });
  }
};

/**
 * GET /api/admin/stripe/config
 * Returns masked Stripe configuration (never returns raw secret keys)
 */
const getAdminStripeConfig = async (_req, res) => {
  try {
    const stored = await readStripeSecretsDoc();
    const secretKey = stored?.secret_key_encrypted
      ? decryptSecret(stored.secret_key_encrypted)
      : getStripeSecretKey();
    const webhookSecret = stored?.webhook_secret_encrypted
      ? decryptSecret(stored.webhook_secret_encrypted)
      : getStripeWebhookSecret();
    const publishableKey = stored?.publishable_key || getStripePublishableKey() || '';
    const mode = stored?.mode || getStripeMode();

    return res.json({
      success: true,
      data: {
        mode,
        source: stored ? 'cms' : getStripeSource(),
        publishableKey,
        hasSecretKey: Boolean(secretKey),
        secretKeyMasked: secretKey ? maskSecret(secretKey) : null,
        hasWebhookSecret: Boolean(webhookSecret),
        webhookSecretMasked: webhookSecret ? maskSecret(webhookSecret) : null,
        updatedAt: stored?.updated_at || null,
        updatedBy: stored?.updated_by || null,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching admin Stripe config:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * PUT /api/admin/stripe/config
 * Encrypts & persists Stripe keys, hot-reloads Stripe SDK, and re-syncs subscription Price
 */
const updateAdminStripeConfig = async (req, res) => {
  try {
    const { mode, publishableKey, secretKey, webhookSecret } = req.body || {};

    const normalizedMode = mode === 'live' ? 'live' : 'test';
    const cleanPk = typeof publishableKey === 'string' ? publishableKey.trim() : '';
    const cleanSk = typeof secretKey === 'string' ? secretKey.trim() : '';
    const cleanWh = typeof webhookSecret === 'string' ? webhookSecret.trim() : '';

    // Validate key prefixes against selected mode
    if (cleanPk) {
      const expectedPkPrefix = normalizedMode === 'live' ? 'pk_live_' : 'pk_test_';
      if (!cleanPk.startsWith(expectedPkPrefix)) {
        return res.status(400).json({
          success: false,
          error: `Publishable key must start with "${expectedPkPrefix}" for ${normalizedMode} mode.`,
        });
      }
    }

    if (cleanSk) {
      const expectedSkPrefix = normalizedMode === 'live' ? 'sk_live_' : 'sk_test_';
      if (!cleanSk.startsWith(expectedSkPrefix)) {
        return res.status(400).json({
          success: false,
          error: `Secret key must start with "${expectedSkPrefix}" for ${normalizedMode} mode.`,
        });
      }
    }

    if (cleanWh && !cleanWh.startsWith('whsec_')) {
      return res.status(400).json({
        success: false,
        error: 'Webhook signing secret must start with "whsec_".',
      });
    }

    const existing = (await readStripeSecretsDoc()) || {};
    const resolvedSecretKey = cleanSk
      ? cleanSk
      : (existing.secret_key_encrypted ? decryptSecret(existing.secret_key_encrypted) : getStripeSecretKey());
    const resolvedWebhookSecret = cleanWh
      ? cleanWh
      : (existing.webhook_secret_encrypted ? decryptSecret(existing.webhook_secret_encrypted) : getStripeWebhookSecret());
    const resolvedPublishableKey = cleanPk || existing.publishable_key || getStripePublishableKey() || '';

    if (!resolvedSecretKey) {
      return res.status(400).json({ success: false, error: 'A Stripe Secret Key is required.' });
    }

    // Verify the secret key actually works with Stripe before saving
    let accountInfo = null;
    try {
      const testStripe = require('stripe')(resolvedSecretKey);
      const acct = await testStripe.accounts.retrieve();
      accountInfo = {
        id: acct.id,
        businessName: acct.business_profile?.name || acct.settings?.dashboard?.display_name || acct.email || acct.id,
        country: acct.country || null,
        chargesEnabled: Boolean(acct.charges_enabled),
        payoutsEnabled: Boolean(acct.payouts_enabled),
      };
    } catch (verifyErr) {
      return res.status(400).json({
        success: false,
        error: `Stripe rejected the secret key: ${verifyErr.message}`,
      });
    }

    const nowIso = new Date().toISOString();
    const docPayload = {
      mode: normalizedMode,
      publishable_key: resolvedPublishableKey,
      secret_key_encrypted: encryptSecret(resolvedSecretKey),
      ...(resolvedWebhookSecret ? { webhook_secret_encrypted: encryptSecret(resolvedWebhookSecret) } : {}),
      updated_at: nowIso,
      updated_by: req.adminUser?.email || req.adminUser?.uid || 'admin',
    };

    await writeStripeSecretsDoc(docPayload);

    // Hot-reload Stripe client on this server immediately
    reloadStripeWithConfig({
      mode: normalizedMode,
      secretKey: resolvedSecretKey,
      publishableKey: resolvedPublishableKey,
      webhookSecret: resolvedWebhookSecret,
      source: 'cms',
    });

    // Re-sync healer subscription Stripe Product/Price on the newly connected account
    try {
      const subConfig = await loadHealerSubscriptionConfig();
      // Reset cached product/price IDs when switching keys so Stripe creates valid ones in the new account/mode
      await syncStripeSubscriptionPrice({
        ...subConfig,
        stripe_product_id: null,
        stripe_monthly_price_id: null,
        stripe_synced_amount_cents: null,
      });
    } catch (syncErr) {
      console.warn('⚠️ Failed to re-sync subscription Price after Stripe config update:', syncErr?.message || syncErr);
    }

    return res.json({
      success: true,
      message: `Stripe configuration saved and active (${normalizedMode.toUpperCase()} mode).`,
      data: {
        mode: normalizedMode,
        source: 'cms',
        publishableKey: resolvedPublishableKey,
        hasSecretKey: true,
        secretKeyMasked: maskSecret(resolvedSecretKey),
        hasWebhookSecret: Boolean(resolvedWebhookSecret),
        webhookSecretMasked: resolvedWebhookSecret ? maskSecret(resolvedWebhookSecret) : null,
        updatedAt: nowIso,
        updatedBy: docPayload.updated_by,
        account: accountInfo,
      },
    });
  } catch (error) {
    console.error('❌ Error updating admin Stripe config:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/admin/stripe/status
 * Returns live Stripe account details, available/pending balance, and read-only payout bank info
 */
const getAdminStripeStatus = async (_req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.json({
        success: true,
        connected: false,
        mode: getStripeMode(),
        error: 'Stripe is not configured.',
      });
    }

    const [account, balance] = await Promise.all([
      stripe.accounts.retrieve(),
      stripe.balance.retrieve(),
    ]);

    const externalAccounts = Array.isArray(account.external_accounts?.data)
      ? account.external_accounts.data.map((ea) => ({
          id: ea.id,
          object: ea.object,
          bankName: ea.bank_name || ea.brand || 'Bank Account',
          last4: ea.last4 || '••••',
          currency: String(ea.currency || 'usd').toUpperCase(),
          defaultForCurrency: Boolean(ea.default_for_currency),
          status: ea.status || 'active',
        }))
      : [];

    return res.json({
      success: true,
      connected: true,
      mode: getStripeMode(),
      source: getStripeSource(),
      account: {
        id: account.id,
        businessName:
          account.business_profile?.name ||
          account.settings?.dashboard?.display_name ||
          account.email ||
          account.id,
        email: account.email || null,
        country: account.country || null,
        defaultCurrency: String(account.default_currency || 'usd').toUpperCase(),
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        payoutSchedule: account.settings?.payouts?.schedule || null,
      },
      balance: {
        available: (balance.available || []).map((b) => ({
          amount: Number((b.amount / 100).toFixed(2)),
          currency: String(b.currency || 'usd').toUpperCase(),
        })),
        pending: (balance.pending || []).map((b) => ({
          amount: Number((b.amount / 100).toFixed(2)),
          currency: String(b.currency || 'usd').toUpperCase(),
        })),
      },
      externalAccounts,
    });
  } catch (error) {
    console.error('❌ Error fetching Stripe status:', error);
    return res.status(500).json({
      success: false,
      connected: false,
      error: error.message,
    });
  }
};

module.exports = {
  verifyAdminToken,
  getAdminStripeConfig,
  updateAdminStripeConfig,
  getAdminStripeStatus,
};
