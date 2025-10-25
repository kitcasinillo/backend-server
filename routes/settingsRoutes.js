const express = require('express');
const router = express.Router();
const {
  getSettings,
  updateSettings,
  getHealerListingLimit,
  resetSettings
} = require('../controllers/settingsController');

/**
 * GET /api/settings
 * Get all application settings
 */
router.get('/', getSettings);

/**
 * PUT /api/settings
 * Update application settings (admin only)
 */
router.put('/', updateSettings);

/**
 * GET /api/settings/healer/:healerId/listing-limit
 * Get listing limit for a specific healer
 */
router.get('/healer/:healerId/listing-limit', getHealerListingLimit);

/**
 * POST /api/settings/reset
 * Reset settings to defaults (admin only)
 */
router.post('/reset', resetSettings);

module.exports = router;

