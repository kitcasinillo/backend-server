const { getStripe, getStripePublishableKey, getStripeMode } = require('../config/stripe');
const { getDatabase } = require('../config/database');
const { initAdmin } = require('../config/firebaseAdmin');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const SETTINGS_COLLECTION = 'settings';
const SETTINGS_DOC = 'app_config';

const DEFAULT_HEALER_SUBSCRIPTION = {
  enabled: true,
  require_card_at_signup: true,
  grandfather_existing_healers: true,
  grandfather_cutoff_iso: '2026-11-25T00:00:00.000Z',
  trial_days: 7,
  upfront_fee_amount: 99,
  monthly_fee_amount: 9.99,
  currency: 'USD',
  plan_name: 'Healer Membership',
  plan_description:
    'Start with a 7-day free trial. After your trial ends, a one-time onboarding fee and monthly membership apply. Cancel anytime during your trial at no charge.',
  stripe_product_id: null,
  stripe_monthly_price_id: null,
  stripe_synced_amount_cents: null,
  stripe_synced_currency: null,
};

/**
 * Normalize subscription config with safe defaults
 */
const normalizeHealerSubscriptionConfig = (raw = {}) => {
  const merged = {
    ...DEFAULT_HEALER_SUBSCRIPTION,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  const trialDays = Number(merged.trial_days);
  const upfrontFee = Number(merged.upfront_fee_amount);
  const monthlyFee = Number(merged.monthly_fee_amount);
  const currency = String(merged.currency || 'USD').trim().toUpperCase() || 'USD';

  return {
    enabled: merged.enabled !== false,
    require_card_at_signup: merged.require_card_at_signup !== false,
    grandfather_existing_healers: merged.grandfather_existing_healers !== false,
    grandfather_cutoff_iso: merged.grandfather_cutoff_iso || DEFAULT_HEALER_SUBSCRIPTION.grandfather_cutoff_iso,
    trial_days: Number.isFinite(trialDays) && trialDays >= 0 ? Math.floor(trialDays) : 7,
    upfront_fee_amount: Number.isFinite(upfrontFee) && upfrontFee >= 0 ? Number(upfrontFee.toFixed(2)) : 99,
    monthly_fee_amount: Number.isFinite(monthlyFee) && monthlyFee > 0 ? Number(monthlyFee.toFixed(2)) : 9.99,
    currency,
    plan_name: String(merged.plan_name || DEFAULT_HEALER_SUBSCRIPTION.plan_name).trim(),
    plan_description: String(merged.plan_description || DEFAULT_HEALER_SUBSCRIPTION.plan_description).trim(),
    stripe_product_id: merged.stripe_product_id || null,
    stripe_monthly_price_id: merged.stripe_monthly_price_id || null,
    stripe_synced_amount_cents: Number.isFinite(Number(merged.stripe_synced_amount_cents))
      ? Number(merged.stripe_synced_amount_cents)
      : null,
    stripe_synced_currency: merged.stripe_synced_currency ? String(merged.stripe_synced_currency).toLowerCase() : null,
  };
};

/**
 * Helper to get Firestore Admin instance if configured
 */
const getAdminDb = () => {
  try {
    const admin = initAdmin();
    return admin ? admin.firestore() : null;
  } catch (_) {
    return null;
  }
};

/**
 * Read a document using Admin SDK if available, falling back to client SDK
 */
const readDoc = async (collectionName, docId) => {
  const adminDb = getAdminDb();
  if (adminDb) {
    const snap = await adminDb.collection(collectionName).doc(docId).get();
    return snap.exists ? snap.data() : null;
  }
  const db = getDatabase();
  if (!db) return null;
  const snap = await getDoc(doc(db, collectionName, docId));
  return snap.exists() ? snap.data() : null;
};

/**
 * Merge-write a document using Admin SDK if available, falling back to client SDK
 */
const mergeDoc = async (collectionName, docId, payload) => {
  const adminDb = getAdminDb();
  if (adminDb) {
    await adminDb.collection(collectionName).doc(docId).set(payload, { merge: true });
    return;
  }
  const db = getDatabase();
  if (!db) {
    throw new Error('Database not initialized');
  }
  await setDoc(doc(db, collectionName, docId), payload, { merge: true });
};

/**
 * Verify optional/required Firebase ID token when Firebase Admin is initialized
 */
const verifyHealerAuth = async (req, targetHealerId) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { verified: false, uid: null, enforced: false };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { verified: false, uid: null, enforced: false };

  try {
    const admin = initAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    if (targetHealerId && decoded.uid !== targetHealerId && !decoded.admin && !decoded.super_admin) {
      return { verified: false, uid: decoded.uid, enforced: true, error: 'Forbidden: healerId mismatch' };
    }
    return { verified: true, uid: decoded.uid, enforced: true };
  } catch (err) {
    return { verified: false, uid: null, enforced: true, error: 'Invalid or expired auth token' };
  }
};

/**
 * Load normalized healer_subscription config from Firestore settings/app_config
 */
const loadHealerSubscriptionConfig = async () => {
  const settings = await readDoc(SETTINGS_COLLECTION, SETTINGS_DOC);
  return normalizeHealerSubscriptionConfig(settings?.healer_subscription);
};

/**
 * Ensure a Stripe Product & recurring monthly Price exist matching the CMS amount & currency.
 * Creates a new immutable Stripe Price whenever monthly_fee_amount or currency changes.
 */
const syncStripeSubscriptionPrice = async (rawConfig) => {
  const config = normalizeHealerSubscriptionConfig(rawConfig);
  const stripe = getStripe();
  if (!stripe) {
    return config;
  }

  const targetAmountCents = Math.round(config.monthly_fee_amount * 100);
  const targetCurrency = config.currency.toLowerCase();

  let productId = config.stripe_product_id;
  let priceId = config.stripe_monthly_price_id;

  // Verify or create Stripe Product
  if (productId) {
    try {
      await stripe.products.retrieve(productId);
    } catch (_) {
      productId = null;
    }
  }

  if (!productId) {
    const product = await stripe.products.create({
      name: config.plan_name || 'Healer Membership',
      description: config.plan_description || 'UltraHealers Practitioner Subscription',
      metadata: { source: 'ultrahealers_cms', type: 'healer_membership' },
    });
    productId = product.id;
  }

  // Create new Stripe Price if missing or if amount/currency changed
  const needsNewPrice =
    !priceId ||
    config.stripe_synced_amount_cents !== targetAmountCents ||
    config.stripe_synced_currency !== targetCurrency;

  if (needsNewPrice) {
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: targetAmountCents,
      currency: targetCurrency,
      recurring: { interval: 'month' },
      metadata: {
        source: 'ultrahealers_cms',
        type: 'healer_membership_monthly',
      },
    });
    priceId = price.id;
  }

  const synced = {
    ...config,
    stripe_product_id: productId,
    stripe_monthly_price_id: priceId,
    stripe_synced_amount_cents: targetAmountCents,
    stripe_synced_currency: targetCurrency,
  };

  await mergeDoc(SETTINGS_COLLECTION, SETTINGS_DOC, {
    healer_subscription: synced,
    updated_at: new Date(),
  });

  return synced;
};

/**
 * Determine whether a healer profile is grandfathered (exempt from mandatory subscription)
 */
const isHealerGrandfathered = (profile, config) => {
  if (!profile) return false;
  if (profile.subscription_exempt === true) return true;
  if (!config?.grandfather_existing_healers) return false;

  const cutoffMs = Date.parse(config.grandfather_cutoff_iso || '');
  if (!Number.isFinite(cutoffMs)) return false;

  const joinedIso = profile.healer_joined_at || profile.healer_created_at || profile.created_at;
  const joinedMs = Date.parse(joinedIso || '');
  if (!Number.isFinite(joinedMs)) return false;

  return joinedMs < cutoffMs;
};

/**
 * GET /api/subscriptions/config
 * Public endpoint returning CMS-editable healer subscription terms
 */
const getSubscriptionConfig = async (_req, res) => {
  try {
    const config = await loadHealerSubscriptionConfig();
    return res.json({
      success: true,
      data: {
        enabled: config.enabled,
        require_card_at_signup: config.require_card_at_signup,
        grandfather_existing_healers: config.grandfather_existing_healers,
        grandfather_cutoff_iso: config.grandfather_cutoff_iso,
        trial_days: config.trial_days,
        upfront_fee_amount: config.upfront_fee_amount,
        monthly_fee_amount: config.monthly_fee_amount,
        currency: config.currency,
        plan_name: config.plan_name,
        plan_description: config.plan_description,
        stripe_publishable_key: getStripePublishableKey(),
        stripe_mode: getStripeMode(),
      },
    });
  } catch (error) {
    console.error('❌ Error fetching subscription config:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/subscriptions/setup-intent
 * Creates or retrieves a Stripe Customer for the healer and returns a SetupIntent client_secret
 */
const createSetupIntent = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }

    const { healerId, healerEmail, healerName } = req.body || {};
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'healerId is required' });
    }

    const authCheck = await verifyHealerAuth(req, healerId);
    if (authCheck.enforced && !authCheck.verified) {
      return res.status(403).json({ success: false, error: authCheck.error || 'Unauthorized' });
    }

    const profile = (await readDoc('profiles', healerId)) || {};
    let customerId = profile.stripe_customer_id || null;

    if (customerId) {
      try {
        const existingCustomer = await stripe.customers.retrieve(customerId);
        if (existingCustomer.deleted) customerId = null;
      } catch (_) {
        customerId = null;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: healerEmail || profile.email || undefined,
        name: healerName || profile.display_name || undefined,
        metadata: {
          healerId,
          platform: 'ultrahealers',
        },
      });
      customerId = customer.id;

      await mergeDoc('profiles', healerId, {
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: {
        healerId,
        purpose: 'healer_subscription_signup',
      },
    });

    return res.json({
      success: true,
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
    });
  } catch (error) {
    console.error('❌ Error creating SetupIntent:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/subscriptions/activate
 * Attaches the saved payment method and creates the Stripe Subscription with CMS trial + upfront fee metadata.
 * - If trial_days > 0: $0 due today; upfront fee ($99) is attached via invoice.created webhook on Day 7 conversion.
 * - If trial_days === 0: upfront fee is billed immediately alongside the first monthly charge.
 */
const activateSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }

    const { healerId, paymentMethodId, healerEmail, healerName } = req.body || {};
    if (!healerId || !paymentMethodId) {
      return res.status(400).json({ success: false, error: 'healerId and paymentMethodId are required' });
    }

    const authCheck = await verifyHealerAuth(req, healerId);
    if (authCheck.enforced && !authCheck.verified) {
      return res.status(403).json({ success: false, error: authCheck.error || 'Unauthorized' });
    }

    const profile = (await readDoc('profiles', healerId)) || {};

    // Idempotency guard: if healer already has an active or trialing subscription, return it
    if (
      profile.stripe_subscription_id &&
      ['trialing', 'active'].includes(String(profile.subscription_status || '').toLowerCase())
    ) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        if (['trialing', 'active'].includes(existingSub.status)) {
          return res.json({
            success: true,
            alreadyActive: true,
            subscription: {
              id: existingSub.id,
              status: existingSub.status,
              trial_end_at: existingSub.trial_end ? new Date(existingSub.trial_end * 1000).toISOString() : null,
              current_period_end: existingSub.current_period_end
                ? new Date(existingSub.current_period_end * 1000).toISOString()
                : null,
            },
          });
        }
      } catch (_) {
        // Subscription not found in Stripe; proceed to create a fresh one
      }
    }

    // Load and sync authoritative CMS pricing
    const rawConfig = await loadHealerSubscriptionConfig();
    const config = await syncStripeSubscriptionPrice(rawConfig);

    if (!config.stripe_monthly_price_id) {
      return res.status(500).json({ success: false, error: 'Failed to sync subscription price with Stripe.' });
    }

    // Ensure Stripe Customer exists
    let customerId = profile.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: healerEmail || profile.email || undefined,
        name: healerName || profile.display_name || undefined,
        metadata: { healerId, platform: 'ultrahealers' },
      });
      customerId = customer.id;
    }

    // Attach payment method (ignore if already attached to this customer)
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (attachErr) {
      if (!String(attachErr?.message || '').toLowerCase().includes('already been attached')) {
        throw attachErr;
      }
    }

    // Set as default payment method for off-session invoicing
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Retrieve card brand/last4 for display
    let cardSummary = null;
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm?.card) {
        cardSummary = {
          brand: pm.card.brand,
          last4: pm.card.last4,
          exp_month: pm.card.exp_month,
          exp_year: pm.card.exp_year,
        };
      }
    } catch (_) {
      // Non-fatal
    }

    const upfrontFeeCents = Math.round(config.upfront_fee_amount * 100);
    const monthlyFeeCents = Math.round(config.monthly_fee_amount * 100);
    const currencyLower = config.currency.toLowerCase();
    const hasTrial = config.trial_days > 0;

    const subscriptionParams = {
      customer: customerId,
      items: [{ price: config.stripe_monthly_price_id }],
      default_payment_method: paymentMethodId,
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      metadata: {
        purchaseType: 'healer_subscription',
        healerId,
        healerEmail: healerEmail || profile.email || '',
        healerName: healerName || profile.display_name || '',
        trial_days: String(config.trial_days),
        upfront_fee_amount_cents: String(upfrontFeeCents),
        monthly_fee_amount_cents: String(monthlyFeeCents),
        upfront_fee_charged: hasTrial ? 'false' : upfrontFeeCents > 0 ? 'true' : 'false',
        currency: currencyLower,
      },
    };

    if (hasTrial) {
      subscriptionParams.trial_period_days = config.trial_days;
    } else if (upfrontFeeCents > 0) {
      // No trial configured: charge upfront fee on the immediate first invoice
      subscriptionParams.add_invoice_items = [
        {
          price_data: {
            currency: currencyLower,
            product: config.stripe_product_id,
            unit_amount: upfrontFeeCents,
          },
        },
      ];
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    const nowIso = new Date().toISOString();
    const trialStartIso = subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null;
    const trialEndIso = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
    const currentPeriodEndIso = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    const profileUpdate = {
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      subscription_plan: 'healer_membership',
      subscription_type: 'premium',
      is_premium: ['trialing', 'active'].includes(subscription.status),
      premium_activated_at: profile.premium_activated_at || nowIso,
      trial_start_at: trialStartIso,
      trial_end_at: trialEndIso,
      current_period_end: currentPeriodEndIso,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      upfront_fee_amount_cents: upfrontFeeCents,
      monthly_fee_amount_cents: monthlyFeeCents,
      subscription_currency: config.currency,
      upfront_fee_charged: !hasTrial && upfrontFeeCents > 0,
      payment_method_summary: cardSummary,
      updated_at: nowIso,
    };

    await mergeDoc('profiles', healerId, profileUpdate);

    return res.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        trial_start_at: trialStartIso,
        trial_end_at: trialEndIso,
        current_period_end: currentPeriodEndIso,
        cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
        upfront_fee_amount: config.upfront_fee_amount,
        monthly_fee_amount: config.monthly_fee_amount,
        currency: config.currency,
        card: cardSummary,
      },
    });
  } catch (error) {
    console.error('❌ Error activating healer subscription:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/subscriptions/status/:healerId
 * Returns the healer's subscription state, grandfathering status, and CMS terms
 */
const getSubscriptionStatus = async (req, res) => {
  try {
    const { healerId } = req.params;
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'healerId is required' });
    }

    const [profile, config] = await Promise.all([
      readDoc('profiles', healerId),
      loadHealerSubscriptionConfig(),
    ]);

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Healer profile not found' });
    }

    const grandfathered = isHealerGrandfathered(profile, config);
    const status = String(profile.subscription_status || 'none').toLowerCase();
    const hasAccess =
      !config.enabled ||
      !config.require_card_at_signup ||
      grandfathered ||
      status === 'trialing' ||
      status === 'active';

    return res.json({
      success: true,
      data: {
        healerId,
        hasAccess,
        grandfathered,
        subscription_exempt: Boolean(profile.subscription_exempt),
        subscription_status: status,
        stripe_customer_id: profile.stripe_customer_id || null,
        stripe_subscription_id: profile.stripe_subscription_id || null,
        trial_start_at: profile.trial_start_at || null,
        trial_end_at: profile.trial_end_at || null,
        current_period_end: profile.current_period_end || null,
        cancel_at_period_end: Boolean(profile.cancel_at_period_end),
        upfront_fee_amount_cents: profile.upfront_fee_amount_cents ?? Math.round(config.upfront_fee_amount * 100),
        monthly_fee_amount_cents: profile.monthly_fee_amount_cents ?? Math.round(config.monthly_fee_amount * 100),
        upfront_fee_charged: Boolean(profile.upfront_fee_charged),
        currency: profile.subscription_currency || config.currency,
        card: profile.payment_method_summary || null,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching subscription status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/subscriptions/portal-session
 * Opens a Stripe Customer Billing Portal session for card updates, invoices, and cancellation
 */
const createBillingPortalSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }

    const { healerId, returnUrl } = req.body || {};
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'healerId is required' });
    }

    const authCheck = await verifyHealerAuth(req, healerId);
    if (authCheck.enforced && !authCheck.verified) {
      return res.status(403).json({ success: false, error: authCheck.error || 'Unauthorized' });
    }

    const profile = await readDoc('profiles', healerId);
    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ success: false, error: 'No Stripe customer found for this healer.' });
    }

    const origin = req.headers.origin || process.env.HEALER_APP_URL || 'http://localhost:5173';
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl || `${origin}/billing`,
    });

    return res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error('❌ Error creating billing portal session:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/subscriptions/cancel
 * Cancels the healer's subscription at period end (or immediately if requested)
 */
const cancelSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }

    const { healerId, immediate = false } = req.body || {};
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'healerId is required' });
    }

    const authCheck = await verifyHealerAuth(req, healerId);
    if (authCheck.enforced && !authCheck.verified) {
      return res.status(403).json({ success: false, error: authCheck.error || 'Unauthorized' });
    }

    const profile = await readDoc('profiles', healerId);
    if (!profile?.stripe_subscription_id) {
      return res.status(400).json({ success: false, error: 'No active subscription found.' });
    }

    let updatedSub;
    if (immediate) {
      updatedSub = await stripe.subscriptions.cancel(profile.stripe_subscription_id);
    } else {
      updatedSub = await stripe.subscriptions.update(profile.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    }

    await mergeDoc('profiles', healerId, {
      subscription_status: updatedSub.status,
      cancel_at_period_end: Boolean(updatedSub.cancel_at_period_end),
      is_premium: ['trialing', 'active'].includes(updatedSub.status),
      updated_at: new Date().toISOString(),
    });

    return res.json({
      success: true,
      subscription: {
        id: updatedSub.id,
        status: updatedSub.status,
        cancel_at_period_end: Boolean(updatedSub.cancel_at_period_end),
      },
    });
  } catch (error) {
    console.error('❌ Error canceling subscription:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const isLocalRequestOrigin = (req) => {
  const candidates = [req.headers.origin, req.headers.referer, req.headers.host].filter(Boolean);
  return candidates.some((val) => {
    const s = String(val);
    return (
      s.includes('localhost') ||
      s.includes('127.0.0.1') ||
      /(^|\/\/)(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?/.test(s)
    );
  });
};

/**
 * POST /api/subscriptions/test-activate
 * DEV/Test-only bypass to simulate card entry & trial activation without calling Stripe
 */
const activateTestSubscription = async (req, res) => {
  try {
    const isUsingLiveStripeKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
    const isAllowed =
      process.env.NODE_ENV !== 'production' ||
      process.env.ALLOW_TEST_SUBSCRIPTION_BYPASS === 'true' ||
      (isLocalRequestOrigin(req) && !isUsingLiveStripeKey);

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        error: 'Test bypass is disabled in production.',
      });
    }

    const { healerId, healerEmail, healerName } = req.body || {};
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'healerId is required' });
    }

    const authCheck = await verifyHealerAuth(req, healerId);
    if (authCheck.enforced && !authCheck.verified) {
      return res.status(403).json({ success: false, error: authCheck.error || 'Unauthorized' });
    }

    const config = await loadHealerSubscriptionConfig();
    const now = new Date();
    const nowIso = now.toISOString();
    const trialDays = config.trial_days;
    const hasTrial = trialDays > 0;
    const trialEndDate = hasTrial ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;
    const nextPeriodEnd = new Date(
      (trialEndDate ? trialEndDate.getTime() : now.getTime()) + 30 * 24 * 60 * 60 * 1000
    );

    const upfrontFeeCents = Math.round(config.upfront_fee_amount * 100);
    const monthlyFeeCents = Math.round(config.monthly_fee_amount * 100);
    const mockCustomerId = `cus_test_bypass_${Date.now()}`;
    const mockSubId = `sub_test_bypass_${Date.now()}`;
    const status = hasTrial ? 'trialing' : 'active';

    const cardSummary = {
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2030,
    };

    const profileUpdate = {
      stripe_customer_id: mockCustomerId,
      stripe_subscription_id: mockSubId,
      subscription_status: status,
      subscription_plan: 'healer_membership',
      subscription_type: 'premium',
      is_premium: true,
      premium_activated_at: nowIso,
      trial_start_at: hasTrial ? nowIso : null,
      trial_end_at: trialEndDate ? trialEndDate.toISOString() : null,
      current_period_end: nextPeriodEnd.toISOString(),
      cancel_at_period_end: false,
      upfront_fee_amount_cents: upfrontFeeCents,
      monthly_fee_amount_cents: monthlyFeeCents,
      subscription_currency: config.currency,
      upfront_fee_charged: !hasTrial && upfrontFeeCents > 0,
      payment_method_summary: cardSummary,
      test_bypass: true,
      ...(healerEmail ? { email: healerEmail } : {}),
      ...(healerName ? { display_name: healerName } : {}),
      updated_at: nowIso,
    };

    await mergeDoc('profiles', healerId, profileUpdate);

    return res.json({
      success: true,
      testBypass: true,
      subscription: {
        id: mockSubId,
        status,
        trial_start_at: profileUpdate.trial_start_at,
        trial_end_at: profileUpdate.trial_end_at,
        current_period_end: profileUpdate.current_period_end,
        cancel_at_period_end: false,
        upfront_fee_amount: config.upfront_fee_amount,
        monthly_fee_amount: config.monthly_fee_amount,
        currency: config.currency,
        card: cardSummary,
      },
    });
  } catch (error) {
    console.error('❌ Error in test subscription activation:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  DEFAULT_HEALER_SUBSCRIPTION,
  normalizeHealerSubscriptionConfig,
  loadHealerSubscriptionConfig,
  syncStripeSubscriptionPrice,
  isHealerGrandfathered,
  getSubscriptionConfig,
  createSetupIntent,
  activateSubscription,
  activateTestSubscription,
  getSubscriptionStatus,
  createBillingPortalSession,
  cancelSubscription,
};
