const express = require('express');
const { handleWebhook } = require('../controllers/webhookController');

const router = express.Router();

// Stripe webhook - needs raw body for signature verification
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), handleWebhook);

module.exports = router;
