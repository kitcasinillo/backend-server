const { getStripe, getStripeWebhookSecret } = require('../config/stripe');
const { initAdmin } = require('../config/firebaseAdmin');
const { getEmailTransporter } = require('../config/email');
const { sendEvent: sendN8nEvent } = require('../utils/n8n');

const sendSubscriptionEmail = async ({ to, subject, text, html }) => {
  try {
    const transporter = getEmailTransporter();
    const fromUser = process.env.EMAIL_USER;
    if (!transporter || !fromUser || !to) return;
    await transporter.sendMail({
      from: `Ultra Healers <${fromUser}>`,
      replyTo: fromUser,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.warn('⚠️ Failed to send subscription lifecycle email:', err?.message || err);
  }
};

const resolveHealerContext = async (stripe, db, { subscriptionId, customerId, metadata }) => {
  let subscription = null;
  let healerId = metadata?.healerId || null;

  if (subscriptionId && stripe) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (!healerId && subscription?.metadata?.healerId) {
        healerId = subscription.metadata.healerId;
      }
    } catch (err) {
      console.warn('⚠️ Could not retrieve subscription:', err?.message || err);
    }
  }

  let profileData = null;
  if (db) {
    if (healerId) {
      const snap = await db.collection('profiles').doc(healerId).get();
      if (snap.exists) profileData = snap.data();
    } else if (subscriptionId) {
      const qSnap = await db.collection('profiles').where('stripe_subscription_id', '==', subscriptionId).limit(1).get();
      if (!qSnap.empty) {
        healerId = qSnap.docs[0].id;
        profileData = qSnap.docs[0].data();
      }
    } else if (customerId) {
      const qSnap = await db.collection('profiles').where('stripe_customer_id', '==', customerId).limit(1).get();
      if (!qSnap.empty) {
        healerId = qSnap.docs[0].id;
        profileData = qSnap.docs[0].data();
      }
    }
  }

  return { healerId, profileData, subscription };
};

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
  const endpointSecret = getStripeWebhookSecret();

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

    case 'invoice.created':
      try {
        const invoice = event.data.object;
        if (invoice.subscription && invoice.billing_reason === 'subscription_cycle' && invoice.status === 'draft') {
          const admin = initAdmin();
          const db = admin.firestore();
          const { healerId, profileData, subscription } = await resolveHealerContext(stripe, db, {
            subscriptionId: invoice.subscription,
            customerId: invoice.customer,
            metadata: invoice.metadata,
          });

          const metaUpfrontCents = Number(subscription?.metadata?.upfront_fee_amount_cents);
          const profileUpfrontCents = Number(profileData?.upfront_fee_amount_cents);
          const upfrontFeeCents = Number.isFinite(metaUpfrontCents)
            ? metaUpfrontCents
            : (Number.isFinite(profileUpfrontCents) ? profileUpfrontCents : 0);

          const alreadyCharged =
            profileData?.upfront_fee_charged === true ||
            subscription?.metadata?.upfront_fee_charged === 'true' ||
            Boolean(profileData?.upfront_fee_invoice_item_id);

          if (!alreadyCharged && upfrontFeeCents > 0) {
            const invoiceItem = await stripe.invoiceItems.create(
              {
                customer: invoice.customer,
                invoice: invoice.id,
                amount: upfrontFeeCents,
                currency: invoice.currency || subscription?.metadata?.currency || 'usd',
                description: 'One-Time Healer Onboarding Fee',
                metadata: {
                  healerId: healerId || '',
                  feeType: 'healer_upfront_onboarding_fee',
                  subscriptionId: invoice.subscription,
                },
              },
              {
                idempotencyKey: `upfront_fee_${invoice.subscription}`,
              }
            );

            if (db && healerId) {
              await db.collection('profiles').doc(healerId).set(
                {
                  upfront_fee_invoice_item_id: invoiceItem.id,
                  upfront_fee_invoice_id: invoice.id,
                  updated_at: new Date().toISOString(),
                },
                { merge: true }
              );
            }
            console.log(`💵 Attached upfront onboarding fee (${upfrontFeeCents} cents) to invoice ${invoice.id} for healer ${healerId}`);
          }
        }
      } catch (handlerErr) {
        console.error('❌ Error handling invoice.created:', handlerErr);
      }
      break;

    case 'invoice.paid':
      try {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const admin = initAdmin();
          const db = admin.firestore();
          const { healerId, profileData, subscription } = await resolveHealerContext(stripe, db, {
            subscriptionId: invoice.subscription,
            customerId: invoice.customer,
            metadata: invoice.metadata,
          });

          const includesUpfrontFee =
            Boolean(profileData?.upfront_fee_invoice_id && profileData.upfront_fee_invoice_id === invoice.id) ||
            (Array.isArray(invoice.lines?.data) &&
              invoice.lines.data.some((line) =>
                String(line.description || '').toLowerCase().includes('onboarding fee')
              ));

          const nowIso = new Date().toISOString();
          const amountPaidCents = Number(invoice.amount_paid || 0);

          if (db && healerId) {
            const profilePatch = {
              subscription_status: subscription?.status || 'active',
              is_premium: true,
              subscription_type: 'premium',
              current_period_end: subscription?.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : profileData?.current_period_end || null,
              updated_at: nowIso,
            };
            if (includesUpfrontFee) {
              profilePatch.upfront_fee_charged = true;
            }
            await db.collection('profiles').doc(healerId).set(profilePatch, { merge: true });

            if (includesUpfrontFee && subscription?.id) {
              try {
                await stripe.subscriptions.update(subscription.id, {
                  metadata: {
                    ...(subscription.metadata || {}),
                    upfront_fee_charged: 'true',
                  },
                });
              } catch (_) {
                // Non-fatal
              }
            }

            // Record invoice in ledger for accurate Admin Finance revenue reporting
            if (amountPaidCents > 0) {
              await db.collection('subscription_invoices').doc(invoice.id).set(
                {
                  invoiceId: invoice.id,
                  healerId,
                  healerEmail: invoice.customer_email || profileData?.email || null,
                  healerName: profileData?.display_name || profileData?.name || '',
                  stripeCustomerId: invoice.customer || null,
                  stripeSubscriptionId: invoice.subscription,
                  amountPaidCents,
                  amountPaid: Number((amountPaidCents / 100).toFixed(2)),
                  currency: String(invoice.currency || 'usd').toUpperCase(),
                  includesUpfrontFee,
                  billingReason: invoice.billing_reason || null,
                  status: 'paid',
                  paidAt: invoice.status_transitions?.paid_at
                    ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
                    : nowIso,
                  hostedInvoiceUrl: invoice.hosted_invoice_url || null,
                  createdAt: nowIso,
                },
                { merge: true }
              );

              const recipientEmail = invoice.customer_email || profileData?.email;
              if (recipientEmail) {
                const formattedAmount = `$${(amountPaidCents / 100).toFixed(2)}`;
                await sendSubscriptionEmail({
                  to: recipientEmail,
                  subject: 'Ultra Healers Membership Payment Receipt',
                  text: `Thank you for your Ultra Healers membership payment of ${formattedAmount}. You can view your invoice here: ${invoice.hosted_invoice_url || ''}`,
                  html: `<p>Thank you for your Ultra Healers membership payment of <strong>${formattedAmount}</strong>.</p>${
                    invoice.hosted_invoice_url
                      ? `<p><a href="${invoice.hosted_invoice_url}">View Invoice</a></p>`
                      : ''
                  }`,
                });
              }
            }
          }
          console.log(`✅ Subscription invoice paid: ${invoice.id} (${amountPaidCents} cents) for healer ${healerId}`);
        }
      } catch (handlerErr) {
        console.error('❌ Error handling invoice.paid:', handlerErr);
      }
      break;

    case 'invoice.payment_failed':
      try {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const admin = initAdmin();
          const db = admin.firestore();
          const { healerId, profileData } = await resolveHealerContext(stripe, db, {
            subscriptionId: invoice.subscription,
            customerId: invoice.customer,
            metadata: invoice.metadata,
          });

          if (db && healerId) {
            await db.collection('profiles').doc(healerId).set(
              {
                subscription_status: 'past_due',
                updated_at: new Date().toISOString(),
              },
              { merge: true }
            );
          }

          const recipientEmail = invoice.customer_email || profileData?.email;
          const healerAppUrl = process.env.HEALER_APP_URL || 'http://localhost:5173';
          if (recipientEmail) {
            await sendSubscriptionEmail({
              to: recipientEmail,
              subject: 'Action Required: Ultra Healers Membership Payment Failed',
              text: `We were unable to process your Ultra Healers membership payment. Please update your payment method at ${healerAppUrl}/billing to avoid interruption to your practitioner account.`,
              html: `<p>We were unable to process your Ultra Healers membership payment.</p><p>Please <a href="${healerAppUrl}/billing">update your payment method</a> to keep your practitioner account active.</p>`,
            });
          }
          console.log(`⚠️ Subscription invoice payment failed: ${invoice.id} for healer ${healerId}`);
        }
      } catch (handlerErr) {
        console.error('❌ Error handling invoice.payment_failed:', handlerErr);
      }
      break;

    case 'customer.subscription.trial_will_end':
      try {
        const sub = event.data.object;
        const admin = initAdmin();
        const db = admin.firestore();
        const { healerId, profileData } = await resolveHealerContext(stripe, db, {
          subscriptionId: sub.id,
          customerId: sub.customer,
          metadata: sub.metadata,
        });

        const recipientEmail = profileData?.email || sub.metadata?.healerEmail;
        const healerAppUrl = process.env.HEALER_APP_URL || 'http://localhost:5173';
        if (recipientEmail) {
          const upfrontDollars = (Number(sub.metadata?.upfront_fee_amount_cents || profileData?.upfront_fee_amount_cents || 9900) / 100).toFixed(2);
          const monthlyDollars = (Number(sub.metadata?.monthly_fee_amount_cents || profileData?.monthly_fee_amount_cents || 999) / 100).toFixed(2);
          const trialEndDate = sub.trial_end ? new Date(sub.trial_end * 1000).toDateString() : 'soon';
          await sendSubscriptionEmail({
            to: recipientEmail,
            subject: 'Your Ultra Healers Free Trial Ends in 3 Days',
            text: `Your Ultra Healers free trial ends on ${trialEndDate}. Unless you cancel beforehand, your saved card will be charged the one-time $${upfrontDollars} onboarding fee plus your first $${monthlyDollars}/month membership. Manage your subscription anytime at ${healerAppUrl}/billing.`,
            html: `<p>Your Ultra Healers free trial ends on <strong>${trialEndDate}</strong>.</p><p>Unless you cancel beforehand, your saved card will be charged the one-time <strong>$${upfrontDollars}</strong> onboarding fee plus your first <strong>$${monthlyDollars}/month</strong> membership.</p><p><a href="${healerAppUrl}/billing">Manage Billing and Subscription</a></p>`,
          });
        }
        console.log(`⏰ Trial ending soon notification sent for healer ${healerId}`);
      } catch (handlerErr) {
        console.error('❌ Error handling customer.subscription.trial_will_end:', handlerErr);
      }
      break;

    case 'customer.subscription.updated':
      try {
        const sub = event.data.object;
        const admin = initAdmin();
        const db = admin.firestore();
        const { healerId } = await resolveHealerContext(stripe, db, {
          subscriptionId: sub.id,
          customerId: sub.customer,
          metadata: sub.metadata,
        });

        if (db && healerId) {
          await db.collection('profiles').doc(healerId).set(
            {
              stripe_subscription_id: sub.id,
              subscription_status: sub.status,
              is_premium: ['trialing', 'active'].includes(sub.status),
              trial_start_at: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
              trial_end_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
              current_period_end: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null,
              cancel_at_period_end: Boolean(sub.cancel_at_period_end),
              updated_at: new Date().toISOString(),
            },
            { merge: true }
          );
        }
        console.log(`🔄 Subscription updated (${sub.status}) for healer ${healerId}`);
      } catch (handlerErr) {
        console.error('❌ Error handling customer.subscription.updated:', handlerErr);
      }
      break;

    case 'customer.subscription.deleted':
      try {
        const sub = event.data.object;
        const admin = initAdmin();
        const db = admin.firestore();
        const { healerId } = await resolveHealerContext(stripe, db, {
          subscriptionId: sub.id,
          customerId: sub.customer,
          metadata: sub.metadata,
        });

        if (db && healerId) {
          await db.collection('profiles').doc(healerId).set(
            {
              subscription_status: 'canceled',
              is_premium: false,
              cancel_at_period_end: false,
              updated_at: new Date().toISOString(),
            },
            { merge: true }
          );
        }
        console.log(`🛑 Subscription canceled for healer ${healerId}`);
      } catch (handlerErr) {
        console.error('❌ Error handling customer.subscription.deleted:', handlerErr);
      }
      break;
      
    default:
      console.log(`ℹ️ Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
};

module.exports = {
  handleWebhook
};
