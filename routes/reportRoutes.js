const express = require('express');
const { 
  getUserReportData, 
  getRetreatReportData, 
  getFinancialReportData,
  getPlatformOverviewData,
  getDisputeReportData
} = require('../controllers/reportsController');

const router = express.Router();

// Get user report data
router.get('/reports/users', getUserReportData);

// Get retreat report data
router.get('/reports/retreats', getRetreatReportData);

// Get financial report data
router.get('/reports/financial', getFinancialReportData);

// Get platform overview data
router.get('/reports/overview', getPlatformOverviewData);

// Get dispute report data
router.get('/reports/disputes', getDisputeReportData);

module.exports = router;
