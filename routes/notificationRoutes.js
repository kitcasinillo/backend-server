const express = require('express');
const { 
  getSchedulerStatus, 
  triggerUnreadMessageNotifications, 
  testUserNotifications, 
  controlScheduler,
  debugBookingMessages,
  sendN8nEvent,
  testWelcomeEmail,
  testAdminNotification
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

// Test sending welcome email
router.post('/test-welcome-email', testWelcomeEmail);

// Test sending admin notification email
router.post('/test-admin-notification', testAdminNotification);

// Send generic event to n8n (signup, booking, etc.)
router.post('/n8n-event', sendN8nEvent);

module.exports = router;
