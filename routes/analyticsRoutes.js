const express = require('express');
const { collectAnalyticsEvent, getAnalyticsStats } = require('../controllers/analyticsController');

const router = express.Router();

// Collector API endpoints (Express strips mount prefix, so paths are relative to mount point)
router.post('/v1/analytics/collect', collectAnalyticsEvent);
router.post('/analytics/collect', collectAnalyticsEvent);
router.post('/collect', collectAnalyticsEvent);

// Admin Stats API endpoints
router.get('/v1/analytics/stats', getAnalyticsStats);
router.get('/admin/analytics/stats', getAnalyticsStats);
router.get('/admin/reports/analytics', getAnalyticsStats);
router.get('/reports/analytics', getAnalyticsStats);
router.get('/analytics/stats', getAnalyticsStats);
router.get('/analytics', getAnalyticsStats);
router.get('/stats', getAnalyticsStats);

module.exports = router;
