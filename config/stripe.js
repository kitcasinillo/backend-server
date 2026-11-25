const { decryptSecret } = require('../utils/secretCrypto');

// Runtime Stripe state (can be initialized from .env and hot-reloaded from CMS Firestore config)
let stripe = null;
let activeSecretKey = null;
let activePublishableKey = null;
let activeWebhookSecret = null;
let activeMode = 'test';
let activeSource = 'unconfigured';

const isPlaceholderKey = (key) =>
  !key ||
  key === 'sk_test_your_stripe_secret_key_here' ||
  key === 'pk_test_your_stripe_publishable_key_here';

const reloadStripeWithConfig = ({
  mode,
  secretKey,
  publishableKey,
  webhookSecret,
  source = 'cms',
} = {}) => {
  try {
    if (secretKey && !isPlaceholderKey(secretKey)) {
      stripe = require('stripe')(secretKey);
      activeSecretKey = secretKey;
      activeMode = mode || (secretKey.startsWith('sk_live_') ? 'live' : 'test');
      activeSource = source;
    }
    if (publishableKey && !isPlaceholderKey(publishableKey)) {
      activePublishableKey = publishableKey;
    }
    if (webhookSecret) {
      activeWebhookSecret = webhookSecret;
    }
    if (stripe) {
      console.log(`✅ Stripe active (${activeMode.toUpperCase()} mode, source: ${activeSource})`);
    }
    return stripe;
  } catch (error) {
    console.error('❌ Failed to reload Stripe configuration:', error.message);
    return null;
  }
};

const initializeStripe = () => {
  const envSecret = process.env.STRIPE_SECRET_KEY;
  const envPublishable = process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || null;
  const envWebhook = process.env.STRIPE_WEBHOOK_SECRET || null;

  if (envPublishable && !isPlaceholderKey(envPublishable)) {
    activePublishableKey = envPublishable;
  }
  if (envWebhook) {
    activeWebhookSecret = envWebhook;
  }

  if (!envSecret) {
    console.error('❌ STRIPE_SECRET_KEY is not set in environment variables');
    return null;
  }
  if (isPlaceholderKey(envSecret)) {
    console.error('❌ STRIPE_SECRET_KEY is still using placeholder value');
    return null;
  }

  return reloadStripeWithConfig({
    mode: envSecret.startsWith('sk_live_') ? 'live' : 'test',
    secretKey: envSecret,
    publishableKey: envPublishable,
    webhookSecret: envWebhook,
    source: 'env',
  });
};

/**
 * Load CMS-managed Stripe keys from Firestore (settings/stripe_secrets) after Firebase initializes.
 * Falls back cleanly to .env values if no CMS config exists.
 */
const loadStripeConfigFromDb = async () => {
  try {
    const { initAdmin } = require('./firebaseAdmin');
    const { getDatabase } = require('./database');
    const { doc, getDoc } = require('firebase/firestore');

    let data = null;
    try {
      const admin = initAdmin();
      if (admin) {
        const snap = await admin.firestore().collection('settings').doc('stripe_secrets').get();
        if (snap.exists) data = snap.data();
      }
    } catch (_) {
      const db = getDatabase();
      if (db) {
        const snap = await getDoc(doc(db, 'settings', 'stripe_secrets'));
        if (snap.exists()) data = snap.data();
      }
    }

    if (!data) return false;

    const secretKey = data.secret_key_encrypted ? decryptSecret(data.secret_key_encrypted) : null;
    const webhookSecret = data.webhook_secret_encrypted ? decryptSecret(data.webhook_secret_encrypted) : null;
    const publishableKey = data.publishable_key || null;

    if (secretKey || publishableKey || webhookSecret) {
      reloadStripeWithConfig({
        mode: data.mode || (secretKey?.startsWith('sk_live_') ? 'live' : 'test'),
        secretKey: secretKey || activeSecretKey,
        publishableKey: publishableKey || activePublishableKey,
        webhookSecret: webhookSecret || activeWebhookSecret,
        source: 'cms',
      });
      return true;
    }
    return false;
  } catch (err) {
    console.warn('⚠️ Could not load CMS Stripe config from Firestore (using .env fallback):', err?.message || err);
    return false;
  }
};

const getStripe = () => stripe;
const getStripeWebhookSecret = () => activeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || null;
const getStripePublishableKey = () =>
  activePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || null;
const getStripeSecretKey = () => activeSecretKey || process.env.STRIPE_SECRET_KEY || null;
const getStripeMode = () => activeMode;
const getStripeSource = () => activeSource;

module.exports = {
  initializeStripe,
  loadStripeConfigFromDb,
  reloadStripeWithConfig,
  getStripe,
  getStripeWebhookSecret,
  getStripePublishableKey,
  getStripeSecretKey,
  getStripeMode,
  getStripeSource,
};
