const cron = require('node-cron');
const NotificationService = require('./notificationService');
const SessionReminderService = require('./sessionReminderService');

const UNREAD_SCHEDULE = '0 */6 * * *';

function getNextSixHourUtcRun(now = new Date()) {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    0,
    0,
    0
  ));
  const nextHour = (Math.floor(now.getUTCHours() / 6) + 1) * 6;
  next.setUTCHours(nextHour, 0, 0, 0);
  return next.toISOString();
}

class CronScheduler {
  constructor() {
    this.notificationService = new NotificationService();
    this.sessionReminderService = new SessionReminderService();
    this.isRunning = false;
    this.unreadTask = null;
    this.reminderTask = null;
    this.lastRunTime = null;
    this.schedule = UNREAD_SCHEDULE;
    this.timezone = 'UTC';
  }

  // Start the cron job scheduler (idempotent — never registers duplicate tasks)
  start() {
    if (this.isRunning) {
      console.log('ℹ️ Cron job scheduler is already running');
      return;
    }

    console.log('🚀 Starting cron job scheduler...');

    // Schedule or resume unread message notifications every 6 hours
    if (!this.unreadTask) {
      this.unreadTask = cron.schedule(this.schedule, async () => {
        await this.runUnreadMessageNotifications();
      }, {
        scheduled: true,
        timezone: this.timezone
      });
    } else {
      this.unreadTask.start();
    }

    // Schedule or resume session reminders (configurable)
    const remindersEnabled = process.env.SESSION_REMINDERS_ENABLED !== 'false';
    const remindersCron = process.env.SESSION_REMINDER_CRON || '*/10 * * * *';
    if (remindersEnabled) {
      if (!this.reminderTask) {
        this.reminderTask = cron.schedule(remindersCron, async () => {
          await this.runSessionReminders();
        }, {
          scheduled: true,
          timezone: this.timezone
        });
      } else {
        this.reminderTask.start();
      }
    } else {
      console.log('ℹ️ Session reminders disabled via SESSION_REMINDERS_ENABLED');
    }

    console.log('✅ Cron jobs scheduled:');
    console.log(`   📧 Unread message notifications: Every 6 hours (${this.schedule} ${this.timezone})`);
    if (remindersEnabled) {
      console.log(`   ⏰ Session reminders: ${remindersCron} ${this.timezone}`);
    }

    this.isRunning = true;
  }

  // Stop the cron job scheduler
  stop() {
    if (!this.isRunning) {
      console.log('ℹ️ Cron job scheduler is already stopped');
      return;
    }

    console.log('🛑 Stopping cron job scheduler...');
    if (this.unreadTask) {
      this.unreadTask.stop();
    }
    if (this.reminderTask) {
      this.reminderTask.stop();
    }
    this.isRunning = false;
    console.log('✅ Cron jobs stopped');
  }

  // Run unread message notifications manually
  async runUnreadMessageNotifications() {
    try {
      console.log('⏰ Running scheduled unread message notifications...');
      const startTime = Date.now();

      const result = await this.notificationService.processUnreadMessageNotifications();
      this.lastRunTime = new Date().toISOString();

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

  // Get scheduler status (aligned with CMS SchedulerStatus contract)
  getStatus() {
    const tasks = [];
    if (this.unreadTask) {
      tasks.push({ name: 'Unread Message Notifications', running: this.isRunning });
    }
    if (this.reminderTask) {
      tasks.push({ name: 'Session Reminders', running: this.isRunning });
    }

    return {
      isRunning: this.isRunning,
      schedule: `Every 6 hours (${this.schedule} ${this.timezone})`,
      timezone: this.timezone,
      nextRunTime: this.isRunning ? getNextSixHourUtcRun() : null,
      lastRunTime: this.lastRunTime,
      tasks
    };
  }

  // Test the notification service (for manual testing)
  async testNotificationService() {
    console.log('🧪 Testing notification service...');
    return await this.runUnreadMessageNotifications();
  }

  // Run session reminders
  async runSessionReminders() {
    try {
      console.log('⏰ Running scheduled session reminders...');
      const startTime = Date.now();
      const result = await this.sessionReminderService.run();
      const duration = Date.now() - startTime;

      console.log(`✅ Session reminders run completed in ${duration}ms`);
      if (result?.totalReminders) {
        console.log(`   🔔 Reminders sent: ${result.totalReminders}`);
      }
      if (result?.errors) {
        console.warn(`   ⚠️ Errors: ${result.errors}`);
      }
      return result;
    } catch (error) {
      console.error('❌ Error in session reminders run:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = CronScheduler;
