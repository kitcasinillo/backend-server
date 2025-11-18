const express = require('express');
const { searchHealers } = require('../controllers/searchController');

const router = express.Router();

// Real healer search
router.post('/healers/search', searchHealers);

module.exports = router;