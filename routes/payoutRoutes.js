const express = require('express');
const { getHealerBalance, createPayout, listPayouts } = require('../controllers/payoutController');

const router = express.Router();

// Get connected account balance for healer
router.get('/balance/:healerId', getHealerBalance);

// Create a payout to healer's bank account
router.post('/create', createPayout);

// List recent payouts
router.get('/history/:healerId', listPayouts);

module.exports = router;