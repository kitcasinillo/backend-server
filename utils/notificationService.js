const { getDatabase, getRealtimeDatabase } = require('../config/database');
const { getEmailTransporter } = require('../config/email');
const { ref, get } = require('firebase/database');
const { collection, query, where, getDocs } = require('firebase/firestore');

class NotificationService {
  constructor() {
    this.db = getDatabase();
    this.realtimeDb = getRealtimeDatabase();
    this.emailTransporter = getEmailTransporter();
  }

  // Get unread messages for a specific user across all their bookings
  async getUnreadMessagesForUser(userId, userType) {
    try {
      console.log(`🔍 Checking unread messages for ${userType}: ${userId}`);
      
      // Check if Realtime Database is available
      if (!this.realtimeDb) {
        console.warn('⚠️ Realtime Database not initialized - cannot check unread messages');
        return [];
      }
      
      let bookingsQuery;
      
      if (userType === 'healer') {
        // Get all bookings where this user is the healer
        bookingsQuery = query(
          collection(this.db, 'bookings'),
          where('healerId', '==', userId)
        );
      } else {
        // Get all bookings where this user is the seeker
        bookingsQuery = query(
          collection(this.db, 'bookings'),
          where('seekerId', '==', userId)
        );
      }

      const bookingsSnapshot = await getDocs(bookingsQuery);
      const unreadMessages = [];

      for (const bookingDoc of bookingsSnapshot.docs) {
        const booking = bookingDoc.data();
        const bookingId = bookingDoc.id;

        try {
          // Check messages in Realtime Database
          const messagesRef = ref(this.realtimeDb, `chats/${bookingId}/messages`);
          const messagesSnapshot = await get(messagesRef);

          if (messagesSnapshot.exists()) {
            let unreadCount = 0;
            const lastMessageTime = new Date(0);

            messagesSnapshot.forEach((childSnapshot) => {
              const messageData = childSnapshot.val();
              
              // Count messages not sent by this user and not read by this user
              if (messageData.senderId !== userId && 
                  (!messageData.readBy || !messageData.readBy[userId])) {
                unreadCount++;
                
                // Track the latest unread message time
                const messageTime = messageData.timestamp ? 
                  (typeof messageData.timestamp === 'number' ? 
                    new Date(messageData.timestamp) : 
                    new Date(messageData.timestamp.toMillis())) : 
                  new Date(0);
                
                if (messageTime > lastMessageTime) {
                  lastMessageTime.setTime(messageTime.getTime());
                }
              }
            });

            if (unreadCount > 0) {
              unreadMessages.push({
                bookingId,
                listingTitle: booking.listingTitle || 'Untitled Service',
                unreadCount,
                lastMessageTime,
                otherPartyName: userType === 'healer' ? 
                  (booking.seekerName || 'Unknown Seeker') : 
                  (booking.healerName || 'Unknown Healer'),
                otherPartyEmail: userType === 'healer' ? 
                  booking.seekerEmail : 
                  booking.healerEmail
              });
            }
          }
        } catch (error) {
          console.warn(`⚠️ Error checking messages for booking ${bookingId}:`, error.message);
          // Continue with other bookings even if one fails
        }
      }

      console.log(`✅ Found ${unreadMessages.length} bookings with unread messages for ${userType} ${userId}`);
      return unreadMessages;
    } catch (error) {
      console.error(`❌ Error getting unread messages for ${userType} ${userId}:`, error);
      return [];
    }
  }

  // Send email notification for unread messages
  async sendUnreadMessagesNotification(userId, userType, unreadMessages) {
    try {
      if (!this.emailTransporter) {
        console.warn('⚠️ Email transporter not configured, skipping notification');
        return { success: false, error: 'Email service not configured' };
      }

      if (unreadMessages.length === 0) {
        console.log(`ℹ️ No unread messages to notify ${userType} ${userId}`);
        return { success: true, message: 'No unread messages' };
      }

      // Get user profile to get email and name
      const profileRef = collection(this.db, 'profiles');
      const profileQuery = query(profileRef, where('__name__', '==', userId));
      const profileSnapshot = await getDocs(profileQuery);
      
      let userEmail = null;
      let userName = null;

      if (!profileSnapshot.empty) {
        const profile = profileSnapshot.docs[0].data();
        userEmail = profile.email || profile.email_address;
        userName = profile.first_name && profile.last_name ? 
          `${profile.first_name} ${profile.last_name}` : 
          profile.display_name || 'User';
      }

      if (!userEmail) {
        console.warn(`⚠️ No email found for ${userType} ${userId}`);
        return { success: false, error: 'User email not found' };
      }

      // Generate email content
      const emailContent = this.generateUnreadMessagesEmail(userName, userType, unreadMessages);
      
      // Send email
      await this.emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: userEmail,
        subject: `You have ${unreadMessages.length} conversation${unreadMessages.length > 1 ? 's' : ''} with unread messages - Ultra Healers`,
        html: emailContent
      });

      console.log(`✅ Sent unread messages notification to ${userType} ${userId} (${userEmail})`);
      return { success: true, emailSent: true };
    } catch (error) {
      console.error(`❌ Error sending notification to ${userType} ${userId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Generate HTML email content for unread messages
  generateUnreadMessagesEmail(userName, userType, unreadMessages) {
    const totalUnread = unreadMessages.reduce((sum, msg) => sum + msg.unreadCount, 0);
    const userTypeDisplay = userType === 'healer' ? 'Healer' : 'Seeker';
    
    let conversationsList = '';
    unreadMessages.forEach((msg, index) => {
      const timeAgo = this.getTimeAgo(msg.lastMessageTime);
      conversationsList += `
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #01A3B4;">
          <h4 style="margin: 0 0 8px 0; color: #01A3B4; font-size: 16px;">${msg.listingTitle}</h4>
          <p style="margin: 0 0 5px 0; color: #666; font-size: 14px;">
            <strong>${userType === 'healer' ? 'Seeker' : 'Healer'}:</strong> ${msg.otherPartyName}
          </p>
          <p style="margin: 0 0 5px 0; color: #666; font-size: 14px;">
            <strong>Unread messages:</strong> ${msg.unreadCount}
          </p>
          <p style="margin: 0; color: #999; font-size: 12px;">
            Last message: ${timeAgo}
          </p>
        </div>
      `;
    });

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff;">
        <div style="background: linear-gradient(135deg, #01A3B4 0%, #0891b2 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Ultra Healers</h1>
          <p style="color: white; margin: 10px 0 0 0; opacity: 0.9;">You have unread messages</p>
        </div>
        
        <div style="padding: 30px;">
          <h2 style="color: #333; margin: 0 0 20px 0;">Hi ${userName || userTypeDisplay},</h2>
          
          <p style="color: #666; line-height: 1.6; margin-bottom: 20px;">
            You have <strong>${totalUnread} unread message${totalUnread > 1 ? 's' : ''}</strong> 
            across <strong>${unreadMessages.length} conversation${unreadMessages.length > 1 ? 's' : ''}</strong>.
          </p>
          
          <div style="margin: 30px 0;">
            ${conversationsList}
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://ultrahealers.com/dashboard" 
               style="background: #01A3B4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Messages
            </a>
          </div>
          
          <p style="color: #999; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            This is an automated notification from Ultra Healers. 
            You can manage your notification preferences in your account settings.
          </p>
        </div>
      </div>
    `;
  }

  // Helper function to get time ago
  getTimeAgo(date) {
    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
  }

  // Process all users and send notifications
  async processUnreadMessageNotifications() {
    try {
      console.log('🔄 Starting unread message notification process...');
      
      // Get all profiles
      const profilesRef = collection(this.db, 'profiles');
      const profilesSnapshot = await getDocs(profilesRef);
      
      let healerNotifications = 0;
      let seekerNotifications = 0;
      let totalEmailsSent = 0;

      for (const profileDoc of profilesSnapshot.docs) {
        const profile = profileDoc.data();
        const userId = profileDoc.id;
        const userType = profile.role || 'seeker';

        try {
          // Get unread messages for this user
          const unreadMessages = await this.getUnreadMessagesForUser(userId, userType);
          
          if (unreadMessages.length > 0) {
            // Send notification
            const result = await this.sendUnreadMessagesNotification(userId, userType, unreadMessages);
            
            if (result.success && result.emailSent) {
              totalEmailsSent++;
              if (userType === 'healer') {
                healerNotifications++;
              } else {
                seekerNotifications++;
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error processing notifications for user ${userId}:`, error);
          // Continue with other users even if one fails
        }
      }

      console.log(`✅ Notification process completed:`);
      console.log(`   📧 Total emails sent: ${totalEmailsSent}`);
      console.log(`   👨‍⚕️ Healer notifications: ${healerNotifications}`);
      console.log(`   👤 Seeker notifications: ${seekerNotifications}`);
      
      return {
        success: true,
        totalEmailsSent,
        healerNotifications,
        seekerNotifications
      };
    } catch (error) {
      console.error('❌ Error in notification process:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = NotificationService;
