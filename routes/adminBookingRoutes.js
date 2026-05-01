const express = require('express');
const {
  listAdminBookings,
  getAdminBookingDetail,
  updateAdminBookingFlags,
} = require('../controllers/adminBookingsController');

const router = express.Router();

router.get('/admin/bookings', listAdminBookings);
router.get('/admin/bookings/:id', getAdminBookingDetail);
router.patch('/admin/bookings/:id/status', updateAdminBookingFlags);

module.exports = router;
