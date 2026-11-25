const express = require('express');
const router = express.Router();
const {
  verifyAdminToken,
  getAdminStripeConfig,
  updateAdminStripeConfig,
  getAdminStripeStatus,
} = require('../controllers/adminStripeController');

router.get('/config', verifyAdminToken, getAdminStripeConfig);
router.put('/config', verifyAdminToken, updateAdminStripeConfig);
router.get('/status', verifyAdminToken, getAdminStripeStatus);

module.exports = router;
