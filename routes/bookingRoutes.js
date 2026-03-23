const express = require('express');
const { createBooking, getBookings, sendChatMessage, cancelBooking } = require('../controllers/bookingController');

const router = express.Router();

// Create booking
router.post('/create-booking', createBooking);

// Get all bookings
router.get('/bookings', getBookings);

// Cancel booking
router.delete('/bookings/:id', cancelBooking);

// Send chat message
router.post('/send-message', sendChatMessage);

module.exports = router;
