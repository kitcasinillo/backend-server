const { getStripe } = require('../config/stripe');
const { getDatabase } = require('../config/database');
const { doc, getDoc } = require('firebase/firestore');
const { initAdmin } = require('../config/firebaseAdmin');
const { calculateCommissionBreakdown } = require('../utils/commissionCalculator');
const { getHealerStripeAccount, createHealerStripeAccount } = require('../utils/stripeConnect');
const { sendEvent: sendN8nEvent } = require('../utils/n8n');

// Create payment intent with commission model
const createPaymentIntent = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      console.error('❌ Stripe is not initialized. Cannot create payment intent.');
      return res.status(500).json({
        success: false,
        error: 'Payment service is not configured. Please check server logs.'
      });
    }

    const { 
      baseAmount, 
      healerId, 
      healerEmail, 
      healerName,
      currency = 'usd', 
      metadata = {} 
    } = req.body;

    // Validate base amount
    if (!baseAmount || baseAmount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid base amount' 
      });
    }

    // Calculate commission breakdown
    const breakdown = calculateCommissionBreakdown(baseAmount);
    
    console.log(`💰 Creating payment intent with commission breakdown:`, breakdown);

    // Check if healer has Stripe Connect account
    let healerStripeAccountId = await getHealerStripeAccount(healerId);
    
    // If no Stripe account, create one
    if (!healerStripeAccountId) {
      try {
        healerStripeAccountId = await createHealerStripeAccount(healerId, healerEmail, healerName);
        console.log(`✅ Created Stripe Connect account for healer: ${healerStripeAccountId}`);
      } catch (accountError) {
        console.error('❌ Failed to create Stripe Connect account:', accountError);
        // Continue without Connect account - we'll handle this in the booking creation
      }
    }

    // Create payment intent with application fee
    const paymentIntentData = {
      amount: breakdown.totalAmount,
      currency,
      metadata: {
        ...metadata,
        baseAmount: breakdown.baseAmount.toString(),
        healerCommission: breakdown.healerCommission.toString(),
        seekerFee: breakdown.seekerFee.toString(),
        processingFee: breakdown.processingFee.toString(),
        healerPayout: breakdown.healerPayout.toString(),
        platformRevenue: breakdown.platformRevenue.toString(),
        healerId,
        healerStripeAccountId: healerStripeAccountId || 'none',
        createdAt: new Date().toISOString()
      },
      automatic_payment_methods: {
        enabled: true,
      }
    };

    // Add application fee if healer has Stripe Connect account
    if (healerStripeAccountId) {
      paymentIntentData.application_fee_amount = breakdown.healerCommission;
      paymentIntentData.transfer_data = {
        destination: healerStripeAccountId,
      };
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

    console.log(`✅ Payment intent created successfully: ${paymentIntent.id}`);

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      breakdown,
      healerStripeAccountId
    });

  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    
    // Provide more specific error messages
    if (error.type === 'StripeAuthenticationError') {
      console.error('🔑 Stripe Authentication Error - Check your API key');
      console.error('Current key (first 10 chars):', process.env.STRIPE_SECRET_KEY?.substring(0, 10) + '...');
    } else if (error.type === 'StripeInvalidRequestError') {
      console.error('📝 Stripe Invalid Request Error - Check request parameters');
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// Calculate commission breakdown
const calculateCommission = async (req, res) => {
  try {
    const { baseAmount } = req.body;
    
    if (!baseAmount || baseAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid base amount is required'
      });
    }

    const breakdown = calculateCommissionBreakdown(baseAmount);
    
    res.json({
      success: true,
      breakdown
    });

  } catch (error) {
    console.error('❌ Error calculating commission:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Create payment intent for premium subscription upgrade
const createPremiumUpgradeIntent = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }

    const {
      healerId,
      healerEmail,
      healerName,
      amount, // cents
      currency = 'usd',
    } = req.body || {};

    const priceCents = Number.isFinite(amount) && amount > 0
      ? Math.floor(amount)
      : Number(process.env.PREMIUM_UPGRADE_PRICE_CENTS || 0);

    if (!healerId || !healerEmail) {
      return res.status(400).json({ success: false, error: 'healerId and healerEmail are required' });
    }
    if (!priceCents || priceCents <= 0) {
      return res.status(400).json({ success: false, error: 'Premium price is not set' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceCents,
      currency,
      metadata: {
        purchaseType: 'premium_upgrade',
        healerId,
        healerEmail,
        healerName: healerName || '',
        createdAt: new Date().toISOString(),
      },
      automatic_payment_methods: { enabled: true },
    });

    // No n8n emission here; emit only after actual activation via webhook

    return res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      price: { amount: priceCents, currency },
    });
  } catch (error) {
    console.error('❌ Error creating premium upgrade intent:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Create Stripe Checkout Session for premium subscription upgrade
const createPremiumUpgradeCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }

    const {
      healerId,
      healerEmail,
      healerName,
      amount, // cents
      currency = 'usd',
      successUrl,
      cancelUrl,
    } = req.body || {};

    let priceCents = Number.isFinite(amount) && amount > 0
      ? Math.floor(amount)
      : Number(process.env.PREMIUM_UPGRADE_PRICE_CENTS || 0);

    // Fallback to settings pricing if price not provided and env not set
    let currencyCode = String(currency || 'usd').toLowerCase();
    if (!priceCents || priceCents <= 0) {
      try {
        const db = getDatabase();
        if (db) {
          const settingsRef = doc(db, 'settings', 'app_config');
          const snap = await getDoc(settingsRef);
          if (snap.exists()) {
            const data = snap.data();
            const premiumAmountUsd = Number(data?.pricing?.premium?.amount);
            const premiumCurrency = String(data?.pricing?.premium?.currency || currencyCode).toLowerCase();
            if (Number.isFinite(premiumAmountUsd) && premiumAmountUsd > 0) {
              priceCents = Math.round(premiumAmountUsd * 100);
              currencyCode = premiumCurrency;
            }
          }
        }
      } catch (settingsErr) {
        console.warn('⚠️ Failed to load pricing from settings:', settingsErr?.message || settingsErr);
      }
    }

    // Only healerId is strictly required
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'healerId is required' });
    }
    if (!priceCents || priceCents <= 0) {
      return res.status(400).json({ success: false, error: 'Premium price is not set' });
    }

    // Fallback URLs if none provided (webhook-only activation)
    const origin = req.headers.origin || process.env.HEALER_APP_URL || 'http://localhost:5173';
    const finalSuccessUrl = successUrl || `${origin}/upgrade?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const finalCancelUrl = cancelUrl || `${origin}/upgrade?status=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      // Add a session-level metadata fallback so webhook can identify purchaseType even if PI retrieval fails
      metadata: {
        purchaseType: 'premium_upgrade',
        healerId,
        healerEmail: healerEmail || '',
        healerName: healerName || '',
      },
      line_items: [
        {
          price_data: {
            currency: currencyCode,
            unit_amount: priceCents,
            product_data: {
              name: 'Premium Subscription',
              description: 'Unlock unlimited listings and featured profile',
            },
          },
          quantity: 1,
        },
      ],
      client_reference_id: healerId,
      ...(healerEmail ? { customer_email: healerEmail } : {}),
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      payment_intent_data: {
        metadata: {
          purchaseType: 'premium_upgrade',
          healerId,
          healerEmail: healerEmail || '',
          healerName: healerName || '',
          createdAt: new Date().toISOString(),
        },
      },
    });

    // No n8n emission here; emit only after actual activation via webhook

    return res.json({
      success: true,
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      price: { amount: priceCents, currency },
    });
  } catch (error) {
    console.error('❌ Error creating premium upgrade checkout session:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Confirm premium upgrade after redirect using Checkout Session ID
const confirmPremiumUpgradeFromCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripe();
    const admin = initAdmin();
    const db = admin.firestore();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Payment service is not configured.' });
    }
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database is not configured.' });
    }

    const sessionId = req.query.session_id || req.query.sessionId || req.body.session_id || req.body.sessionId;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'session_id is required' });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (e) {
      console.error('❌ Failed to retrieve Checkout Session:', e);
      return res.status(400).json({ success: false, error: 'Invalid session_id' });
    }

    const healerId = session.client_reference_id;
    const healerEmail = session.customer_details?.email || null;
    const healerName = '';
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'HealerId missing in session' });
    }

    // Only activate if paid
    if (session.payment_status !== 'paid') {
      return res.status(200).json({ success: false, status: session.payment_status, message: 'Payment not completed yet' });
    }

    // Retrieve PaymentIntent for details
    let pi = null;
    if (session.payment_intent) {
      try {
        pi = await stripe.paymentIntents.retrieve(session.payment_intent);
      } catch (e) {
        console.warn('⚠️ Could not retrieve PaymentIntent:', e?.message || e);
      }
    }

    // Update profile to premium (idempotent)
    let alreadyPremium = false;
    let activatedAt = null;
    try {
      const profileRef = db.collection('profiles').doc(healerId);
      const snap = await profileRef.get();
      alreadyPremium = snap.exists && (snap.data()?.is_premium === true || snap.data()?.subscription_type === 'premium');
      activatedAt = snap.exists ? (snap.data()?.premium_activated_at || null) : null;
      if (!alreadyPremium) {
        await profileRef.update({
          is_premium: true,
          subscription_type: 'premium',
          premium_activated_at: new Date().toISOString(),
          featured: true,
          updated_at: new Date().toISOString(),
        });
        activatedAt = new Date().toISOString();
      }
    } catch (e) {
      console.error('❌ Failed to update healer premium status (confirm):', e);
    }

    // Emit healer.premium.activated as a fallback when webhook isn’t reaching the server.
    // Use idempotency key based on healerId and sessionId to avoid duplicates.
    try {
      const idempotencyKey = `healer.premium.activated:${healerId}:${sessionId}`;
      const amountCents = typeof (pi?.amount) === 'number' ? pi.amount : null;
      const amount = typeof amountCents === 'number' ? amountCents / 100 : null;
      const actIso = activatedAt || new Date().toISOString();
      const actHuman = (() => {
        try {
          return new Date(actIso).toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
          });
        } catch (_) {
          return actIso;
        }
      })();
      const createdIso = session?.created ? new Date(session.created * 1000).toISOString() : undefined;
      const createdHuman = createdIso ? new Date(createdIso).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
      }) : undefined;
      await sendN8nEvent('healer.premium.activated', {
        healerId,
        email: healerEmail,
        name: healerName,
        subscription: {
          tier: 'premium',
          activatedAt: actIso,
          activatedAtHuman: actHuman,
          createdAt: createdIso,
          createdAtHuman: createdHuman,
        },
        payment: {
          paymentIntentId: session?.payment_intent || pi?.id || null,
          amount,
          amount_cents: amountCents,
          currency: pi?.currency || null,
          status: 'succeeded',
        },
      }, { idempotencyKey, meta: { source: 'backend:paymentController.confirm' }, retry: { retries: 2, backoffMs: 500 } });
      console.log('📤 Sent healer.premium.activated (confirm) to n8n');
    } catch (n8nErr) {
      console.warn('⚠️ Failed to send healer.premium.activated (confirm):', n8nErr?.message || n8nErr);
    }


    return res.json({ success: true, premiumActivated: true, healerId, paymentIntentId: session?.payment_intent || pi?.id || null });
  } catch (error) {
    console.error('❌ Error confirming premium upgrade session:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  createPaymentIntent,
  calculateCommission,
  createPremiumUpgradeIntent,
  createPremiumUpgradeCheckoutSession,
  confirmPremiumUpgradeFromCheckoutSession,
};
