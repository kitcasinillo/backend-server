const { getDatabase } = require('../config/database');
const { collection, query, where, getDocs, orderBy, doc, updateDoc } = require('firebase/firestore');
const { sendEvent } = require('./n8n');

class SessionReminderService {
  constructor(config = {}) {
    const windowsStr = process.env.SESSION_REMINDER_WINDOWS || config.windows || '24h,1h';
    this.windows = this.parseWindows(windowsStr);
    this.windowWidthMinutes = parseInt(process.env.SESSION_REMINDER_WINDOW_WIDTH_MINUTES || config.windowWidthMinutes || '10', 10);
    this.defaultTimezone = process.env.DEFAULT_TIMEZONE || config.defaultTimezone || 'UTC';
  }

  parseWindows(windowsStr) {
    return windowsStr.split(',').map(w => w.trim()).filter(Boolean).map(label => {
      const m = label.match(/^(\d+)([mh])$/i);
      if (!m) return null;
      const value = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const ms = unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
      return { label, offsetMs: ms };
    }).filter(Boolean);
  }

  async run() {
    const db = getDatabase();
    if (!db) {
      console.warn('⚠️ Firestore not initialized; skipping session reminders');
      return { success: false, error: 'db_unavailable' };
    }

    const now = Date.now();
    const widthMs = this.windowWidthMinutes * 60 * 1000;
    let totalReminders = 0;
    let errors = 0;

    for (const win of this.windows) {
      const startMs = now + win.offsetMs;
      const endMs = startMs + widthMs;
      const startIso = new Date(startMs).toISOString();
      const endIso = new Date(endMs).toISOString();

      try {
        const bookingsRef = collection(db, 'bookings');
        const q = query(
          bookingsRef,
          where('sessionDate', '>=', startIso),
          where('sessionDate', '<', endIso),
          orderBy('sessionDate')
        );
        const snap = await getDocs(q);

        if (snap.empty) {
          continue;
        }

        for (const docSnap of snap.docs) {
          const bookingId = docSnap.id;
          const data = docSnap.data();
          // Skip if marker exists
          if (data?.reminders && data.reminders[win.label]) {
            continue;
          }
          const seekerEmail = data?.seekerEmail;
          const healerEmail = data?.healerEmail;
          const sessionDate = data?.sessionDate;
          const tz = data?.timezone || this.defaultTimezone;
          if (!seekerEmail || !healerEmail || !sessionDate) {
            continue;
          }

          const payload = {
            bookingId,
            seeker: { name: data?.seekerName || 'Seeker', email: seekerEmail },
            healer: { name: data?.healerName || 'Healer', email: healerEmail },
            sessionDate,
            timezone: tz,
          };
          const idempotencyKey = `session.reminder:${bookingId}:${win.label}`;

          try {
            const result = await sendEvent('session.reminder', payload, { idempotencyKey, meta: { source: 'backend:cron' }, retry: { retries: 2, backoffMs: 500 } });
            if (result?.sent) {
              totalReminders++;
              const refDoc = doc(db, 'bookings', bookingId);
              await updateDoc(refDoc, { [`reminders.${win.label}`]: true });
            } else {
              errors++;
              console.warn(`⚠️ session.reminder not sent for ${bookingId} (${win.label}):`, result?.reason || result?.status);
            }
          } catch (e) {
            errors++;
            console.error(`❌ Failed to send session.reminder for ${bookingId} (${win.label}):`, e.message);
          }
        }
      } catch (e) {
        errors++;
        console.error(`❌ Reminder window ${win.label} query failed:`, e.message);
      }
    }

    if (totalReminders > 0) {
      console.log(`✅ Session reminders sent: ${totalReminders}`);
    } else {
      console.log('ℹ️ No session reminders due in current windows');
    }
    if (errors > 0) {
      console.warn(`⚠️ Session reminder errors: ${errors}`);
    }
    return { success: true, totalReminders, errors };
  }
}

module.exports = SessionReminderService;