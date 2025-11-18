const express = require('express');
const router = express.Router();

const { getAllModalities } = require('../controllers/modalitiesController');

// Public route to fetch active modalities
router.get('/modalities', getAllModalities);

module.exports = router;