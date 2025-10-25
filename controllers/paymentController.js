const { getStripe } = require('../config/stripe');
const { calculateCommissionBreakdown } = require('../utils/commissionCalculator');
const { getHealerStripeAccount, createHealerStripeAccount } = require('../utils/stripeConnect');

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

module.exports = {
  createPaymentIntent,
  calculateCommission
};
