const express = require('express');
const { searchHealers, adminSearchHealers } = require('../controllers/searchController');

const router = express.Router();

// Real healer search
router.post('/healers/search', searchHealers);

// Admin healer search for payouts and operations
router.get('/healers/admin-search', adminSearchHealers);

module.exports = router;
