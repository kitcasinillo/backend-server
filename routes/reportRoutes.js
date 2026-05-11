const express = require('express');
const { getUserReportData, getRetreatReportData, getFinancialReportData } = require('../controllers/reportsController');

const router = express.Router();

// Get user report data
router.get('/reports/users', getUserReportData);

// Get retreat report data
router.get('/reports/retreats', getRetreatReportData);

module.exports = router;
