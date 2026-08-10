const NotificationService = require('../utils/notificationService');
const CronScheduler = require('../utils/cronScheduler');

// Global scheduler instance
let globalScheduler = null;

// Initialize the global scheduler
const initializeScheduler = () => {
  if (!globalScheduler) {
    globalScheduler = new CronScheduler();
    globalScheduler.start();
  }
  return globalScheduler;
};

// Get scheduler status
const getSchedulerStatus = async (req, res) => {
  try {
    const scheduler = initializeScheduler();
    const status = scheduler.getStatus();
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('❌ Error getting scheduler status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Manually trigger unread message notifications
const triggerUnreadMessageNotifications = async (req, res) => {
  try {
    console.log('🔧 Manual trigger of unread message notifications requested');
    
    const scheduler = initializeScheduler();
    const result = await scheduler.runUnreadMessageNotifications();
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Unread message notifications processed successfully',
        data: {
          totalEmailsSent: result.totalEmailsSent,
          healerNotifications: result.healerNotifications,
          seekerNotifications: result.seekerNotifications
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to process notifications'
      });
    }
  } catch (error) {
    console.error('❌ Error triggering notifications:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Test notification service for a specific user
const testUserNotifications = async (req, res) => {
  try {
    const { userId, userType } = req.body;
    
    if (!userId || !userType) {
      return res.status(400).json({
        success: false,
        error: 'userId and userType are required'
      });
    }

    console.log(`🧪 Testing notifications for ${userType}: ${userId}`);
    
    const notificationService = new NotificationService();
    const unreadMessages = await notificationService.getUnreadMessagesForUser(userId, userType);
    
    if (unreadMessages.length > 0) {
      const result = await notificationService.sendUnreadMessagesNotification(userId, userType, unreadMessages);
      
      res.json({
        success: true,
        message: 'Test notification sent',
        data: {
          unreadMessages,
          emailSent: result.emailSent,
          totalUnread: unreadMessages.reduce((sum, msg) => sum + msg.unreadCount, 0)
        }
      });
    } else {
      res.json({
        success: true,
        message: 'No unread messages found for this user',
        data: {
          unreadMessages: [],
          emailSent: false,
          totalUnread: 0
        }
      });
    }
  } catch (error) {
    console.error('❌ Error testing user notifications:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Start/stop scheduler
const controlScheduler = async (req, res) => {
  try {
    const { action } = req.body;
    
    if (!action || !['start', 'stop'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'action must be "start" or "stop"'
      });
    }

    const scheduler = initializeScheduler();
    
    if (action === 'stop') {
      scheduler.stop();
      res.json({
        success: true,
        message: 'Scheduler stopped successfully'
      });
    } else {
      scheduler.start();
      res.json({
        success: true,
        message: 'Scheduler started successfully'
      });
    }
  } catch (error) {
    console.error('❌ Error controlling scheduler:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Debug booking messages
const debugBookingMessages = async (req, res) => {
  try {
    const { bookingId, userId, userType } = req.body;
    
    if (!bookingId || !userId || !userType) {
      return res.status(400).json({
        success: false,
        error: 'bookingId, userId, and userType are required'
      });
    }

    console.log(`🧪 DEBUG: Checking messages for booking ${bookingId}, user ${userId} (${userType})`);
    
    const notificationService = new NotificationService();
    
    // Check if Realtime Database is available
    if (!notificationService.realtimeDb) {
      return res.status(500).json({
        success: false,
        error: 'Realtime Database not initialized. Check FIREBASE_DATABASE_URL in .env file.'
      });
    }

    // Get messages from Realtime Database
    const { ref, get } = require('firebase/database');
    const messagesRef = ref(notificationService.realtimeDb, `chats/${bookingId}/messages`);
    
    try {
      const messagesSnapshot = await get(messagesRef);
      
      if (messagesSnapshot.exists()) {
        const messages = [];
        let unreadCount = 0;
        
        messagesSnapshot.forEach((childSnapshot) => {
          const messageData = childSnapshot.val();
          const isUnread = messageData.senderId !== userId && 
                          (!messageData.readBy || !messageData.readBy[userId]);
          
          if (isUnread) unreadCount++;
          
          messages.push({
            id: childSnapshot.key,
            senderId: messageData.senderId,
            senderName: messageData.senderName,
            text: messageData.text?.substring(0, 100) + '...',
            timestamp: messageData.timestamp,
            readBy: messageData.readBy,
            isUnread
          });
        });
        
        res.json({
          success: true,
          bookingId,
          userId,
          userType,
          totalMessages: messages.length,
          unreadCount,
          messages
        });
      } else {
        res.json({
          success: true,
          bookingId,
          userId,
          userType,
          totalMessages: 0,
          unreadCount: 0,
          messages: [],
          message: 'No messages found for this booking'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: `Error accessing Realtime Database: ${error.message}`,
        details: error
      });
    }
  } catch (error) {
    console.error('❌ Error in debug booking messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const { sendEvent } = require('../utils/n8n');

// Send event to n8n webhook for notifications and send welcome email directly if event is signup
const sendN8nEvent = async (req, res) => {
  try {
    const event = req.body?.event || req.body?.eventType;
    let payload = req.body?.payload;

    // If a flat JSON with eventType was posted, treat remaining fields as payload
    if (!payload && req.body?.eventType) {
      const { eventType, ...rest } = req.body;
      payload = rest;
    }

    if (!event || !payload) {
      return res.status(400).json({ success: false, error: 'event/eventType and payload are required' });
    }

    let welcomeResult = null;
    let adminNotificationResult = null;
    const signupEvents = ['signup_seeker', 'signup_healer', 'account.signup', 'user.created'];
    if (signupEvents.includes(event)) {
      const email = payload.email;
      const name = payload.display_name || payload.name || payload.first_name || '';
      const role = (event === 'signup_healer' || payload.role === 'healer') ? 'healer' : 'seeker';
      const userId = payload.id || payload.userId || null;

      if (email) {
        console.log(`📧 Automatically sending welcome email for event ${event} to ${role} (${email})...`);
        const notificationService = new NotificationService();
        welcomeResult = await notificationService.sendWelcomeEmail(email, name, role);

        console.log(`🔔 Sending admin notification email for new ${role} signup (${email})...`);
        adminNotificationResult = await notificationService.sendAdminSignupNotification(email, name, role, userId);
      }
    }

    let result = null;
    try {
      result = await sendEvent(event, payload, { meta: { source: 'backend:notificationController' } });
    } catch (n8nErr) {
      console.warn('⚠️ n8n event forward skipped/failed:', n8nErr.message);
      result = { sent: false, reason: n8nErr.message };
    }

    return res.json({ success: true, result, welcomeEmail: welcomeResult, adminNotification: adminNotificationResult });
  } catch (error) {
    console.error('❌ Error sending n8n event / welcome email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Manually trigger a test welcome email for seeker or healer
const testWelcomeEmail = async (req, res) => {
  try {
    const { email, name, role } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required' });
    }
    const userRole = role || 'seeker';
    console.log(`🧪 Testing welcome email trigger for ${userRole} (${email})...`);
    
    const notificationService = new NotificationService();
    const result = await notificationService.sendWelcomeEmail(email, name || 'Test User', userRole);

    if (result.success) {
      res.json({
        success: true,
        message: `Welcome email sent successfully to ${userRole} (${email})`,
        result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send welcome email'
      });
    }
  } catch (error) {
    console.error('❌ Error in testWelcomeEmail endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Manually trigger a test admin signup notification email
const testAdminNotification = async (req, res) => {
  try {
    const { email, name, role, userId } = req.body;
    const userEmail = email || 'testuser@example.com';
    const userName = name || 'Test User';
    const userRole = role || 'seeker';

    console.log(`🧪 Testing admin signup notification for ${userRole} (${userEmail})...`);
    
    const notificationService = new NotificationService();
    const result = await notificationService.sendAdminSignupNotification(userEmail, userName, userRole, userId || 'test-uid-123');

    if (result.success) {
      res.json({
        success: true,
        message: `Admin signup notification sent successfully to ${result.recipient}`,
        result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send admin signup notification'
      });
    }
  } catch (error) {
    console.error('❌ Error in testAdminNotification endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getSchedulerStatus,
  triggerUnreadMessageNotifications,
  testUserNotifications,
  controlScheduler,
  debugBookingMessages,
  initializeScheduler,
  sendN8nEvent,
  testWelcomeEmail,
  testAdminNotification
};
