const express = require('express');
const { 
  getStripeAccount, 
  createStripeAccount, 
  getStripeAccountLink 
} = require('../controllers/healerController');

const router = express.Router();

// Get healer's Stripe Connect account status
router.get('/stripe-account/:healerId', getStripeAccount);

// Create Stripe Connect account for healer
router.post('/create-stripe-account', createStripeAccount);

// Get Stripe Connect account link for onboarding
router.post('/stripe-account-link', getStripeAccountLink);

module.exports = router;
