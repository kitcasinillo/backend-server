const express = require('express');
const router = express.Router();
const { getPayoutSettings, savePayoutSettings } = require('../controllers/payoutSettingsController');

// Get payout settings for a healer
router.get('/settings/:healerId', getPayoutSettings);

// Save/update payout settings
router.post('/settings', express.json(), savePayoutSettings);

module.exports = router;