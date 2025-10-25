const cron = require('node-cron');
const NotificationService = require('./notificationService');

class CronScheduler {
  constructor() {
    this.notificationService = new NotificationService();
    this.isRunning = false;
  }

  // Start the cron job scheduler
  start() {
    console.log('🚀 Starting cron job scheduler...');
    
    // Schedule unread message notifications every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      await this.runUnreadMessageNotifications();
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    console.log('✅ Cron jobs scheduled:');
    console.log('   📧 Unread message notifications: Every 6 hours');
    
    this.isRunning = true;
  }

  // Stop the cron job scheduler
  stop() {
    console.log('🛑 Stopping cron job scheduler...');
    cron.getTasks().forEach(task => task.stop());
    this.isRunning = false;
    console.log('✅ Cron jobs stopped');
  }

  // Run unread message notifications manually
  async runUnreadMessageNotifications() {
    try {
      console.log('⏰ Running scheduled unread message notifications...');
      const startTime = Date.now();
      
      const result = await this.notificationService.processUnreadMessageNotifications();
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        console.log(`✅ Scheduled notification run completed in ${duration}ms`);
        console.log(`   📧 Emails sent: ${result.totalEmailsSent}`);
        console.log(`   👨‍⚕️ Healer notifications: ${result.healerNotifications}`);
        console.log(`   👤 Seeker notifications: ${result.seekerNotifications}`);
      } else {
        console.error(`❌ Scheduled notification run failed: ${result.error}`);
      }
      
      return result;
    } catch (error) {
      console.error('❌ Error in scheduled notification run:', error);
      return { success: false, error: error.message };
    }
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      tasks: cron.getTasks().map(task => ({
        name: task.name || 'Unnamed task',
        running: task.running
      }))
    };
  }

  // Test the notification service (for manual testing)
  async testNotificationService() {
    console.log('🧪 Testing notification service...');
    return await this.runUnreadMessageNotifications();
  }
}

module.exports = CronScheduler;
