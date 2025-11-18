const express = require('express');
const { createPaymentIntent, calculateCommission, createPremiumUpgradeIntent, createPremiumUpgradeCheckoutSession, confirmPremiumUpgradeFromCheckoutSession } = require('../controllers/paymentController');

const router = express.Router();

// Create payment intent with commission model
router.post('/create-payment-intent', createPaymentIntent);

// Calculate commission breakdown
router.post('/calculate-commission', calculateCommission);

// Create premium upgrade payment intent
router.post('/premium-upgrade-intent', createPremiumUpgradeIntent);

// Create premium upgrade Stripe Checkout session
router.post('/premium-upgrade-checkout-session', createPremiumUpgradeCheckoutSession);

// Confirm premium upgrade after redirect using session_id
router.get('/premium-upgrade-confirm', confirmPremiumUpgradeFromCheckoutSession);
router.post('/premium-upgrade-confirm', confirmPremiumUpgradeFromCheckoutSession);

module.exports = router;
