const express = require('express');
const { createPaymentIntent, calculateCommission } = require('../controllers/paymentController');

const router = express.Router();

// Create payment intent with commission model
router.post('/create-payment-intent', createPaymentIntent);

// Calculate commission breakdown
router.post('/calculate-commission', calculateCommission);

module.exports = router;
