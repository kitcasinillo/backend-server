const { getStripe } = require('../config/stripe');
const { initAdmin } = require('../config/firebaseAdmin');
const { sendEvent: sendN8nEvent } = require('../utils/n8n');

// Stripe webhook handler
const handleWebhook = async (req, res) => {
  // Trace webhook entry for debugging
  try {
    console.log('🔔 Stripe webhook endpoint hit');
    const rawType = Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body;
    console.log(`🔎 Incoming webhook body type: ${rawType}`);
  } catch (_) {
    // no-op
  }
  // Check if Stripe is initialized
  const stripe = getStripe();
  if (!stripe) {
    console.error('❌ Stripe is not initialized. Cannot process webhook.');
    return res.status(500).json({
      success: false,
      error: 'Payment service is not configured'
    });
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    console.error('❌ STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({
      success: false,
      error: 'Webhook secret not configured'
    });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log(`📨 Webhook received: ${event.type}`);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('➡️ Check STRIPE_WEBHOOK_SECRET and the exact endpoint URL configured in Stripe.');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('✅ PaymentIntent was successful:', paymentIntent.id);
      try {
        const purchaseType = paymentIntent?.metadata?.purchaseType;
        if (purchaseType === 'premium_upgrade') {
          const healerId = paymentIntent?.metadata?.healerId;
          const healerEmail = paymentIntent?.metadata?.healerEmail;
          const healerName = paymentIntent?.metadata?.healerName || '';
          const admin = initAdmin();
          const db = admin.firestore();
          if (!db) {
            console.warn('⚠️ Firebase Admin not initialized; cannot persist premium activation');
          } else if (healerId) {
            try {
              const profileRef = db.collection('profiles').doc(healerId);
              const snap = await profileRef.get();
              const alreadyPremium = snap.exists && (snap.data()?.is_premium === true || snap.data()?.subscription_type === 'premium');
              if (!alreadyPremium) {
                await profileRef.update({
                  is_premium: true,
                  subscription_type: 'premium',
                  premium_activated_at: new Date().toISOString(),
                  featured: true,
                  updated_at: new Date().toISOString(),
                });
                console.log(`🎉 Premium activated for healer: ${healerId}`);
              } else {
                console.log(`ℹ️ Healer ${healerId} already premium; skipping re-activation`);
              }
            } catch (e) {
              console.error('❌ Failed to update healer premium status:', e);
            }
          }

          // Do not emit here; defer emission to checkout.session.completed to avoid duplicates

          // No longer emitting generic payment.completed events for subscription payments
        } else {
          // Non-upgrade intents log commission metadata if present
          console.log('💰 Commission breakdown:', {
            baseAmount: paymentIntent.metadata?.baseAmount,
            healerCommission: paymentIntent.metadata?.healerCommission,
            seekerFee: paymentIntent.metadata?.seekerFee,
            platformRevenue: paymentIntent.metadata?.platformRevenue
          });
        }
      } catch (handlerErr) {
        console.error('❌ Error handling payment_intent.succeeded:', handlerErr);
      }
      break;

    case 'checkout.session.completed':
      try {
        const session = event.data.object;
        console.log('🧾 Checkout session completed:', session.id);
        const stripe = getStripe();
        const admin = initAdmin();
        const db = admin.firestore();

        // Retrieve the PaymentIntent to access metadata
        let pi = null;
        if (session.payment_intent) {
          try {
            pi = await stripe.paymentIntents.retrieve(session.payment_intent);
          } catch (e) {
            console.warn('⚠️ Could not retrieve PaymentIntent for session:', e?.message || e);
          }
        }

        // Prefer PaymentIntent metadata; fall back to session.metadata if PI retrieval fails
        const purchaseType = pi?.metadata?.purchaseType || session?.metadata?.purchaseType;
        const healerId = pi?.metadata?.healerId || session.client_reference_id;
        const healerEmail = pi?.metadata?.healerEmail || session.customer_details?.email || null;
        const healerName = pi?.metadata?.healerName || session?.metadata?.healerName || '';
        if (!purchaseType) {
          console.log('ℹ️ No purchaseType metadata found on PI/session; premium activation will be skipped unless explicitly detected.');
        }

        // Only handle premium upgrades here; other checkout flows should not trigger premium activation
        if (purchaseType === 'premium_upgrade' && healerId && session.payment_status === 'paid') {
          let alreadyPremium = false;
          let activatedAt = null;
          if (!db) {
            console.warn('⚠️ Firebase Admin not initialized; cannot persist premium activation (checkout.session.completed)');
          } else if (healerId) {
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
                console.log(`🎉 Premium activated (checkout) for healer: ${healerId}`);
                activatedAt = new Date().toISOString();
              } else {
                // Ensure premium_activated_at exists even if previously activated outside webhook
                if (!activatedAt) {
                  activatedAt = new Date().toISOString();
                  try {
                    await profileRef.update({ premium_activated_at: activatedAt, updated_at: new Date().toISOString() });
                  } catch (_) {
                    // Non-fatal; continue to emit event
                  }
                }
                console.log(`ℹ️ Healer ${healerId} already premium; skipping re-activation (checkout)`);
              }
            } catch (e) {
              console.error('❌ Failed to update healer premium status from checkout.session.completed:', e);
            }
          }

          // Emit event once per checkout session; use idempotency key to prevent dupes
          try {
            const idempotencyKey = `healer.premium.activated:${healerId}:${session.id}`;
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
            }, { idempotencyKey, meta: { source: 'backend:webhookController' }, retry: { retries: 2, backoffMs: 500 } });
            console.log('📤 Sent healer.premium.activated (checkout) to n8n');
          } catch (n8nErr) {
            console.warn('⚠️ Failed to send healer.premium.activated (checkout):', n8nErr?.message || n8nErr);
          }

          // No longer emitting payment.completed (checkout) for subscription payments
        }
      } catch (handlerErr) {
        console.error('❌ Error handling checkout.session.completed:', handlerErr);
      }
      break;
      
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('❌ PaymentIntent failed:', failedPayment.id);
      break;
      
    case 'account.updated':
      const account = event.data.object;
      console.log('🔄 Stripe Connect account updated:', account.id);
      // You can update healer's profile status here
      break;
      
    default:
      console.log(`ℹ️ Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
};

module.exports = {
  handleWebhook
};
