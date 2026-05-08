const express = require('express');
const { getRevenueStats, getCommissionReport, getPremiumSubscriptions } = require('../controllers/adminFinanceController');

const router = express.Router();

router.get('/revenue-stats', getRevenueStats);
router.get('/commission-report', getCommissionReport);
router.get('/premium-subscriptions', getPremiumSubscriptions);

module.exports = router;
