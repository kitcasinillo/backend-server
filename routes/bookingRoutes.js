const express = require('express');
const { createBooking, getBookings, sendChatMessage } = require('../controllers/bookingController');

const router = express.Router();

// Create booking
router.post('/create-booking', createBooking);

// Get all bookings
router.get('/bookings', getBookings);

// Send chat message
router.post('/send-message', sendChatMessage);

module.exports = router;
