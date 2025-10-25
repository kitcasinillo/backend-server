const { getStripe } = require('../config/stripe');

// Stripe webhook handler
const handleWebhook = async (req, res) => {
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
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('✅ PaymentIntent was successful:', paymentIntent.id);
      console.log('💰 Commission breakdown:', {
        baseAmount: paymentIntent.metadata.baseAmount,
        healerCommission: paymentIntent.metadata.healerCommission,
        seekerFee: paymentIntent.metadata.seekerFee,
        platformRevenue: paymentIntent.metadata.platformRevenue
      });
      // Here you can update your database or send notifications
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
