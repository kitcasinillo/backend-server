// Stripe initialization with error handling
let stripe = null;

const initializeStripe = () => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('❌ STRIPE_SECRET_KEY is not set in environment variables');
      console.error('Please add your Stripe secret key to the .env file');
      console.error('Example: STRIPE_SECRET_KEY=sk_test_your_actual_secret_key_here');
      return null;
    } else if (process.env.STRIPE_SECRET_KEY === 'sk_test_your_stripe_secret_key_here') {
      console.error('❌ STRIPE_SECRET_KEY is still using the placeholder value');
      console.error('Please replace the placeholder with your actual Stripe secret key');
      return null;
    } else {
      stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      console.log('✅ Stripe initialized successfully');
      console.log(`🔑 Stripe key type: ${process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'Test' : 'Live'}`);
      return stripe;
    }
  } catch (error) {
    console.error('❌ Failed to initialize Stripe:', error.message);
    console.error('Please check your STRIPE_SECRET_KEY configuration');
    return null;
  }
};

const getStripe = () => stripe;

module.exports = {
  initializeStripe,
  getStripe
};
