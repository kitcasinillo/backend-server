const express = require('express');
const { 
  getSchedulerStatus, 
  triggerUnreadMessageNotifications, 
  testUserNotifications, 
  controlScheduler,
  debugBookingMessages
} = require('../controllers/notificationController');

const router = express.Router();

// Get scheduler status
router.get('/scheduler-status', getSchedulerStatus);

// Manually trigger unread message notifications
router.post('/trigger-notifications', triggerUnreadMessageNotifications);

// Test notifications for a specific user
router.post('/test-user-notifications', testUserNotifications);

// Control scheduler (start/stop)
router.post('/control-scheduler', controlScheduler);

// Debug booking messages
router.post('/debug-booking-messages', debugBookingMessages);

module.exports = router;
