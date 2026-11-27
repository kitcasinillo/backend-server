const { getDatabase } = require('../config/database');
const { getEmailTransporter } = require('../config/email');
const {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
} = require('firebase/firestore');

const FEEDBACK_COLLECTION = 'user_feedback';
const PROMPT_LOGS_COLLECTION = 'feedback_prompt_logs';

const VALID_CATEGORIES = ['feature_request', 'improvement', 'bug_report', 'general'];
const VALID_IMPACTS = ['nice_to_have', 'important', 'critical'];
const VALID_STATUSES = ['new', 'under_review', 'planned', 'in_progress', 'completed', 'declined'];
const VALID_APP_SOURCES = ['seeker-app', 'healer-app', 'retreats-app', 'email_prompt', 'booking_email'];
const COOLDOWN_DAYS = 30;

const toIso = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return new Date().toISOString();
};

const serializeFeedback = (id, data = {}) => ({
  id,
  title: String(data.title || ''),
  description: String(data.description || ''),
  category: VALID_CATEGORIES.includes(data.category) ? data.category : 'feature_request',
  impact: VALID_IMPACTS.includes(data.impact) ? data.impact : 'important',
  appSource: String(data.appSource || 'seeker-app'),
  promptSource: data.promptSource ? String(data.promptSource) : 'in_app_widget',
  pageUrl: String(data.pageUrl || '/'),
  userId: data.userId ? String(data.userId) : null,
  userName: String(data.userName || 'Guest'),
  userEmail: data.userEmail ? String(data.userEmail) : null,
  userRole: ['seeker', 'healer', 'guest'].includes(data.userRole) ? data.userRole : 'guest',
  status: VALID_STATUSES.includes(data.status) ? data.status : 'new',
  adminNotes: String(data.adminNotes || ''),
  reviewedBy: data.reviewedBy || null,
  createdAt: toIso(data.createdAt),
  updatedAt: toIso(data.updatedAt || data.createdAt),
});

/**
 * POST /api/feedback
 * Submits a user feature request / feedback item.
 * Login (userId) is required for seeker-app and healer-app; guest is allowed only for retreats-app.
 */
async function submitFeedback(req, res) {
  try {
    const {
      title,
      description,
      category = 'feature_request',
      impact = 'important',
      appSource = 'seeker-app',
      promptSource = 'in_app_widget',
      pageUrl = '/',
      userId = null,
      userName = null,
      userEmail = null,
      userRole = 'guest',
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    const cleanDescription = String(description || '').trim();

    if (!cleanTitle || !cleanDescription) {
      return res.status(400).json({
        success: false,
        error: 'Title and description are required',
      });
    }

    const normalizedSource = VALID_APP_SOURCES.includes(appSource) ? appSource : 'seeker-app';

    // Require login (userId) for seeker-app and healer-app; allow guest for retreats-app
    if (normalizedSource !== 'retreats-app' && !userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication is required to submit feedback from this app',
      });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const now = new Date().toISOString();
    const payload = {
      title: cleanTitle.slice(0, 160),
      description: cleanDescription.slice(0, 4000),
      category: VALID_CATEGORIES.includes(category) ? category : 'feature_request',
      impact: VALID_IMPACTS.includes(impact) ? impact : 'important',
      appSource: normalizedSource,
      promptSource: String(promptSource || 'in_app_widget').slice(0, 64),
      pageUrl: String(pageUrl || '/').slice(0, 250),
      userId: userId ? String(userId) : null,
      userName: String(userName || (normalizedSource === 'retreats-app' ? 'Retreat Visitor' : 'User')).slice(0, 120),
      userEmail: userEmail ? String(userEmail).trim().slice(0, 160) : null,
      userRole: normalizedSource === 'retreats-app' && !userId
        ? 'guest'
        : ['seeker', 'healer'].includes(userRole)
          ? userRole
          : normalizedSource === 'healer-app'
            ? 'healer'
            : 'seeker',
      status: 'new',
      adminNotes: '',
      reviewedBy: null,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await addDoc(collection(db, FEEDBACK_COLLECTION), payload);

    return res.status(201).json({
      success: true,
      id: docRef.id,
      feedback: serializeFeedback(docRef.id, payload),
    });
  } catch (error) {
    console.error('❌ Error submitting feedback:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to submit feedback',
    });
  }
}

/**
 * GET /api/feedback
 */
async function listFeedback(req, res) {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const { status, category, appSource, userRole, impact, search } = req.query || {};
    const snapshot = await getDocs(collection(db, FEEDBACK_COLLECTION));
    let items = snapshot.docs.map((d) => serializeFeedback(d.id, d.data()));

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const summary = {
      new: items.filter((i) => i.status === 'new').length,
      underReview: items.filter((i) => i.status === 'under_review').length,
      planned: items.filter((i) => i.status === 'planned').length,
      inProgress: items.filter((i) => i.status === 'in_progress').length,
      completed: items.filter((i) => i.status === 'completed').length,
      total: items.length,
    };

    if (status && status !== 'all') {
      items = items.filter((i) => i.status === status);
    }
    if (category && category !== 'all') {
      items = items.filter((i) => i.category === category);
    }
    if (appSource && appSource !== 'all') {
      items = items.filter((i) => i.appSource === appSource);
    }
    if (userRole && userRole !== 'all') {
      items = items.filter((i) => i.userRole === userRole);
    }
    if (impact && impact !== 'all') {
      items = items.filter((i) => i.impact === impact);
    }
    if (search && String(search).trim()) {
      const q = String(search).toLowerCase().trim();
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.userName.toLowerCase().includes(q) ||
          (i.userEmail || '').toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q)
      );
    }

    return res.status(200).json({
      success: true,
      items,
      total: items.length,
      summary,
    });
  } catch (error) {
    console.error('❌ Error listing feedback:', error);
    return res.status(500).json({ success: false, error: 'Failed to load feedback' });
  }
}

/**
 * GET /api/feedback/summary
 */
async function getFeedbackSummary(req, res) {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const q = query(collection(db, FEEDBACK_COLLECTION), where('status', '==', 'new'));
    const snapshot = await getDocs(q);
    const newCount = snapshot.size;

    return res.status(200).json({
      success: true,
      newCount,
      hasNew: newCount > 0,
    });
  } catch (error) {
    console.error('❌ Error fetching feedback summary:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch feedback summary' });
  }
}

/**
 * PATCH /api/feedback/:id
 */
async function updateFeedback(req, res) {
  try {
    const { id } = req.params;
    const { status, impact, adminNotes, reviewedBy, notifyUser = false, resolutionMessage = '' } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, error: 'Feedback ID is required' });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }
    if (impact && !VALID_IMPACTS.includes(impact)) {
      return res.status(400).json({ success: false, error: 'Invalid impact value' });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const ref = doc(db, FEEDBACK_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Feedback entry not found' });
    }

    const existing = snap.data() || {};
    const updates = { updatedAt: new Date().toISOString() };
    if (status) updates.status = status;
    if (impact) updates.impact = impact;
    if (typeof adminNotes === 'string') updates.adminNotes = adminNotes;
    if (reviewedBy) updates.reviewedBy = reviewedBy;

    await updateDoc(ref, updates);
    const updatedSnap = await getDoc(ref);
    const serialized = serializeFeedback(updatedSnap.id, updatedSnap.data());

    // Optional status/resolution email notification to the user
    let emailSent = false;
    let emailError = null;

    if (notifyUser && serialized.userEmail) {
      try {
        const transporter = getEmailTransporter();
        if (!transporter || !process.env.EMAIL_USER) {
          emailError = 'Email service is not configured on the server';
        } else {
          const statusLabelMap = {
            new: 'New',
            under_review: 'Under Review',
            planned: 'Planned',
            in_progress: 'In Progress',
            completed: 'Completed',
            declined: 'Declined',
          };
          const statusLabel = statusLabelMap[serialized.status] || serialized.status;
          const greeting = serialized.userName && serialized.userName !== 'Guest' && serialized.userName !== 'Retreat Visitor'
            ? `Hi ${serialized.userName},`
            : 'Hi there,';
          const cleanNote = String(resolutionMessage || '').trim();
          const escapedNote = cleanNote.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
          const escapedTitle = serialized.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

          const noteHtml = cleanNote
            ? `<div style="margin: 16px 0; padding: 14px 16px; background: #f8fafc; border-left: 4px solid #01A3B4; border-radius: 6px; color: #334155; font-size: 14px; line-height: 1.6;">${escapedNote}</div>`
            : '';
          const noteText = cleanNote ? `\nNote from our team:\n${cleanNote}\n` : '';

          // LESSON-002: strict EMAIL_USER alignment, replyTo, no subject emojis
          const fromEmail = process.env.EMAIL_USER;
          const subject = `Update on your UltraHealers feedback: ${serialized.title.slice(0, 80)}`;
          const html = `
            <div style="font-family: Arial, Helvetica, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; color: #1e293b;">
              <h2 style="margin: 0 0 14px; color: #0f172a; font-size: 20px;">Feedback Status Update</h2>
              <p style="margin: 0 0 14px; color: #334155; line-height: 1.6;">${greeting}</p>
              <p style="margin: 0 0 14px; color: #334155; line-height: 1.6;">
                Thank you for sharing your feedback with UltraHealers. Your submission
                <strong>"${escapedTitle}"</strong> has been updated to:
                <strong style="color: #01A3B4;">${statusLabel}</strong>.
              </p>
              ${noteHtml}
              <p style="margin: 20px 0 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                We appreciate you helping us make UltraHealers better for everyone.
              </p>
              <p style="margin: 18px 0 0; color: #64748b; font-size: 13px;">
                Warm regards,<br/>The UltraHealers Team
              </p>
            </div>
          `;
          const text = `${greeting}\n\nThank you for sharing your feedback with UltraHealers. Your submission "${serialized.title}" has been updated to: ${statusLabel}.\n${noteText}\nWe appreciate you helping us make UltraHealers better for everyone.\n\nWarm regards,\nThe UltraHealers Team`;

          await transporter.sendMail({
            from: `UltraHealers <${fromEmail}>`,
            replyTo: fromEmail,
            to: serialized.userEmail,
            subject,
            text,
            html,
          });
          emailSent = true;
        }
      } catch (mailErr) {
        console.error('⚠️ Failed to send feedback update email:', mailErr);
        emailError = mailErr?.message || 'Failed to send notification email';
      }
    }

    return res.status(200).json({
      success: true,
      feedback: serialized,
      emailSent,
      emailError,
      previousStatus: existing.status || 'new',
    });
  } catch (error) {
    console.error('❌ Error updating feedback:', error);
    return res.status(500).json({ success: false, error: 'Failed to update feedback' });
  }
}

/**
 * DELETE /api/feedback/:id
 */
async function deleteFeedback(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Feedback ID is required' });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const ref = doc(db, FEEDBACK_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Feedback entry not found' });
    }

    await deleteDoc(ref);
    return res.status(200).json({ success: true, id });
  } catch (error) {
    console.error('❌ Error deleting feedback:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete feedback' });
  }
}

/**
 * POST /api/feedback/send-prompt
 * Sends a targeted email prompt inviting a user to submit a feature request.
 * Follows LESSON-002: strict EMAIL_USER from alignment, replyTo header, no subject emojis.
 */
async function sendFeedbackPromptEmail(req, res) {
  try {
    const {
      recipientEmail,
      recipientName = '',
      userRole = 'seeker',
      customMessage = '',
      sentBy = 'Admin',
      force = false,
    } = req.body || {};

    const cleanEmail = String(recipientEmail || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'A valid recipientEmail is required' });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    // 30-day cooldown check unless force === true
    if (!force) {
      const logQuery = query(
        collection(db, PROMPT_LOGS_COLLECTION),
        where('recipientEmail', '==', cleanEmail)
      );
      const logSnap = await getDocs(logQuery);
      const cutoffMs = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const recentlySent = logSnap.docs.some((d) => {
        const sentAt = new Date(toIso(d.data()?.sentAt)).getTime();
        return sentAt > cutoffMs;
      });

      if (recentlySent) {
        return res.status(429).json({
          success: false,
          error: `A feedback prompt was already sent to ${cleanEmail} within the last ${COOLDOWN_DAYS} days.`,
        });
      }
    }

    const transporter = getEmailTransporter();
    if (!transporter || !process.env.EMAIL_USER) {
      return res.status(503).json({
        success: false,
        error: 'Email service is not configured on the server',
      });
    }

    const targetAppUrl =
      userRole === 'healer'
        ? (process.env.HEALER_APP_URL || 'https://healer.ultrahealers.com').replace(/\/+$/, '')
        : userRole === 'retreat'
          ? (process.env.RETREATS_APP_URL || 'https://retreats.ultrahealers.com').replace(/\/+$/, '')
          : (process.env.SEEKER_APP_URL || 'https://app.ultrahealers.com').replace(/\/+$/, '');

    const feedbackLink = `${targetAppUrl}/?feedback=1&source=email_prompt`;
    const greeting = recipientName ? `Hi ${String(recipientName).trim()},` : 'Hi there,';
    const customBlock = customMessage
      ? `<p style="margin: 0 0 16px; color: #334155; line-height: 1.6;">${String(customMessage).trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
      : '';
    const customPlain = customMessage ? `\n${String(customMessage).trim()}\n` : '';

    const subject = 'Share your ideas to help shape UltraHealers';
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 20px;">We would love your feedback</h2>
        <p style="margin: 0 0 14px; color: #334155; line-height: 1.6;">${greeting}</p>
        <p style="margin: 0 0 16px; color: #334155; line-height: 1.6;">
          We are continuously improving UltraHealers based on what our community needs most.
          If there is a feature you would love to see or something we can make better, we would be grateful to hear from you.
        </p>
        ${customBlock}
        <p style="margin: 24px 0;">
          <a href="${feedbackLink}" style="display: inline-block; background-color: #01A3B4; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: 600; font-size: 14px;">
            Share a Feature Request
          </a>
        </p>
        <p style="margin: 0 0 12px; color: #64748b; font-size: 13px; line-height: 1.5;">
          Or open this link in your browser: <a href="${feedbackLink}" style="color: #01A3B4;">${feedbackLink}</a>
        </p>
        <p style="margin: 24px 0 0; color: #64748b; font-size: 13px;">
          Warm regards,<br/>The UltraHealers Team
        </p>
      </div>
    `;

    const text = `${greeting}\n\nWe are continuously improving UltraHealers based on what our community needs most. If there is a feature you would love to see or something we can make better, we would be grateful to hear from you.\n${customPlain}\nShare a Feature Request: ${feedbackLink}\n\nWarm regards,\nThe UltraHealers Team`;

    // LESSON-002: strict from alignment with EMAIL_USER, include replyTo, no subject emojis
    const fromEmail = process.env.EMAIL_USER;
    await transporter.sendMail({
      from: `UltraHealers <${fromEmail}>`,
      replyTo: fromEmail,
      to: cleanEmail,
      subject,
      text,
      html,
    });

    const now = new Date().toISOString();
    await addDoc(collection(db, PROMPT_LOGS_COLLECTION), {
      recipientEmail: cleanEmail,
      recipientName: String(recipientName || '').trim(),
      userRole,
      sentBy,
      feedbackLink,
      sentAt: now,
    });

    return res.status(200).json({
      success: true,
      message: `Feedback prompt email sent to ${cleanEmail}`,
      feedbackLink,
    });
  } catch (error) {
    console.error('❌ Error sending feedback prompt email:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send feedback prompt email',
    });
  }
}

module.exports = {
  submitFeedback,
  listFeedback,
  getFeedbackSummary,
  updateFeedback,
  deleteFeedback,
  sendFeedbackPromptEmail,
};
