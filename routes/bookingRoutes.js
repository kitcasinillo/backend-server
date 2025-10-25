const express = require('express');
const { createBooking, sendChatMessage } = require('../controllers/bookingController');

const router = express.Router();

// Create booking
router.post('/create-booking', createBooking);

// Send chat message
router.post('/send-message', sendChatMessage);

module.exports = router;
