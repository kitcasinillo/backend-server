const express = require('express');
const { createBooking, getBookings, getBooking, sendChatMessage, cancelBooking, getRetreatBookings, cancelRetreatBooking } = require('../controllers/bookingController');

const router = express.Router();

// Create booking
router.post('/create-booking', createBooking);

// Get all bookings
router.get('/bookings', getBookings);
router.get('/retreat-bookings', getRetreatBookings);

// Get a single booking
router.get('/bookings/:id', getBooking);

// Cancel booking
router.post('/bookings/cancel/:id', cancelBooking);
router.post('/retreat-bookings/cancel/:id', cancelRetreatBooking);

// Send chat message
router.post('/bookings/chat', sendChatMessage);

module.exports = router;
