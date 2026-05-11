const express = require('express');
const { getUserReportData } = require('../controllers/reportsController');

const router = express.Router();

// Get user report data
router.get('/reports/users', getUserReportData);

module.exports = router;
