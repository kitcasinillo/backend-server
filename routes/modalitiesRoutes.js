const express = require('express');
const router = express.Router();

const { getAllModalities, createModality } = require('../controllers/modalitiesController');

// Public route to fetch active modalities
router.get('/modalities', getAllModalities);

// Protected-like route to add modality
router.post('/modalities', createModality);

module.exports = router;