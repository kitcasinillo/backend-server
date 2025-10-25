const { getStripe } = require('../config/stripe');
const { getHealerStripeAccount, createHealerStripeAccount } = require('../utils/stripeConnect');

// Get healer's Stripe Connect account status
const getStripeAccount = async (req, res) => {
  try {
    const { healerId } = req.params;
    const stripe = getStripe();
    
    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe service not configured'
      });
    }

    const stripeAccountId = await getHealerStripeAccount(healerId);
    
    if (!stripeAccountId) {
      return res.json({
        success: true,
        hasAccount: false,
        accountId: null,
        accountStatus: null
      });
    }

    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(stripeAccountId);
    
    res.json({
      success: true,
      hasAccount: true,
      accountId: stripeAccountId,
      accountStatus: account.charges_enabled ? 'active' : 'pending',
      accountDetails: {
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        details_submitted: account.details_submitted,
        requirements: account.requirements
      }
    });

  } catch (error) {
    console.error('❌ Error getting healer Stripe account:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Create Stripe Connect account for healer
const createStripeAccount = async (req, res) => {
  try {
    const { healerId, healerEmail, healerName } = req.body;
    
    if (!healerId || !healerEmail) {
      return res.status(400).json({
        success: false,
        error: 'Healer ID and email are required'
      });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe service not configured'
      });
    }

    // Check if account already exists
    const existingAccountId = await getHealerStripeAccount(healerId);
    if (existingAccountId) {
      return res.json({
        success: true,
        accountId: existingAccountId,
        message: 'Stripe account already exists'
      });
    }

    // Create new account
    const accountId = await createHealerStripeAccount(healerId, healerEmail, healerName);
    
    res.json({
      success: true,
      accountId,
      message: 'Stripe Connect account created successfully'
    });

  } catch (error) {
    console.error('❌ Error creating Stripe Connect account:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get Stripe Connect account link for onboarding
const getStripeAccountLink = async (req, res) => {
  try {
    const { healerId, returnUrl, refreshUrl } = req.body;
    
    if (!healerId) {
      return res.status(400).json({
        success: false,
        error: 'Healer ID is required'
      });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe service not configured'
      });
    }

    const stripeAccountId = await getHealerStripeAccount(healerId);
    
    if (!stripeAccountId) {
      return res.status(404).json({
        success: false,
        error: 'Stripe Connect account not found'
      });
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl || 'https://ultrahealers.com/healer/dashboard',
      return_url: returnUrl || 'https://ultrahealers.com/healer/dashboard',
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      accountLink: accountLink.url
    });

  } catch (error) {
    console.error('❌ Error creating account link:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getStripeAccount,
  createStripeAccount,
  getStripeAccountLink
};
