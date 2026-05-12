const express = require('express');
const { getUserReportData, getRetreatReportData, getFinancialReportData } = require('../controllers/reportsController');

const router = express.Router();

// Get user report data
router.get('/reports/users', getUserReportData);

// Get retreat report data
router.get('/reports/retreats', getRetreatReportData);

// Get financial report data
router.get('/reports/financial', getFinancialReportData);

module.exports = router;
