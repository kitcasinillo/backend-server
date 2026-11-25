const express = require('express');
const router = express.Router();
const {
  getSubscriptionConfig,
  createSetupIntent,
  activateSubscription,
  activateTestSubscription,
  getSubscriptionStatus,
  createBillingPortalSession,
  cancelSubscription,
} = require('../controllers/subscriptionController');

// Public CMS subscription terms for healer signup/billing UI
router.get('/config', getSubscriptionConfig);

// Create Stripe SetupIntent for embedded card entry at signup
router.post('/setup-intent', createSetupIntent);

// Activate subscription after card setup succeeds
router.post('/activate', activateSubscription);

// DEV-ONLY bypass to test subscription flow without Stripe card entry
router.post('/test-activate', activateTestSubscription);

// Get subscription status & grandfathering access state for a healer
router.get('/status/:healerId', getSubscriptionStatus);

// Create Stripe Billing Portal session for self-service management
router.post('/portal-session', createBillingPortalSession);

// Cancel subscription (at period end or immediately)
router.post('/cancel', cancelSubscription);

module.exports = router;
