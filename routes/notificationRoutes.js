const express = require('express');
const { 
  getSchedulerStatus, 
  triggerUnreadMessageNotifications, 
  testUserNotifications, 
  controlScheduler,
  debugBookingMessages,
  sendN8nEvent
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

// Send generic event to n8n (signup, booking, etc.)
router.post('/n8n-event', sendN8nEvent);

module.exports = router;
