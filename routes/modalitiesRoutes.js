const express = require('express');
const router = express.Router();

const { getAllModalities, createModality, updateModality, deleteModality } = require('../controllers/modalitiesController');

// Public route to fetch active modalities
router.get('/modalities', getAllModalities);

// Protected-like route to add modality
router.post('/modalities', createModality);
router.put('/modalities/:id', updateModality);
router.delete('/modalities/:id', deleteModality);

module.exports = router;