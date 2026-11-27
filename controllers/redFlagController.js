const { getDatabase } = require('../config/database');
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
const { detectRedFlags } = require('../utils/redFlagDetector');

const RED_FLAGS_COLLECTION = 'red_flag_alerts';
const VALID_STATUSES = ['open', 'reviewed', 'dismissed', 'action_taken'];
const VALID_ACTIONS = ['none', 'warned_user', 'suspended_user', 'dismissed_false_positive'];

const toIso = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return new Date().toISOString();
};

const serializeAlert = (id, data = {}) => ({
  id,
  bookingId: String(data.bookingId || ''),
  messageId: data.messageId ? String(data.messageId) : null,
  text: String(data.text || ''),
  senderId: String(data.senderId || ''),
  senderName: String(data.senderName || 'Unknown User'),
  senderType: data.senderType === 'healer' ? 'healer' : 'seeker',
  receiverId: data.receiverId ? String(data.receiverId) : null,
  receiverName: data.receiverName ? String(data.receiverName) : null,
  bookingPaymentStatus: data.bookingPaymentStatus ? String(data.bookingPaymentStatus) : null,
  severity: data.severity || 'low',
  categories: Array.isArray(data.categories) ? data.categories : [],
  matches: Array.isArray(data.matches) ? data.matches : [],
  status: VALID_STATUSES.includes(data.status) ? data.status : 'open',
  adminNotes: String(data.adminNotes || ''),
  actionTaken: VALID_ACTIONS.includes(data.actionTaken) ? data.actionTaken : 'none',
  reviewedBy: data.reviewedBy || null,
  reviewedAt: data.reviewedAt ? toIso(data.reviewedAt) : null,
  createdAt: toIso(data.createdAt),
  updatedAt: toIso(data.updatedAt || data.createdAt),
});

/**
 * POST /api/moderation/red-flags/scan
 * Independently scans a sent chat message and records a red-flag alert if triggered.
 */
async function scanAndFlagMessage(req, res) {
  try {
    const {
      bookingId,
      messageId = null,
      text,
      senderId,
      senderName = 'Unknown User',
      senderType = 'seeker',
      receiverId = null,
      receiverName = null,
      bookingPaymentStatus = null,
    } = req.body || {};

    if (!bookingId || !text || !senderId) {
      return res.status(400).json({
        success: false,
        error: 'bookingId, text, and senderId are required',
      });
    }

    const detection = detectRedFlags(String(text));

    if (!detection.flagged) {
      return res.status(200).json({
        success: true,
        flagged: false,
      });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database not initialized',
      });
    }

    const now = new Date().toISOString();
    const alertPayload = {
      bookingId: String(bookingId),
      messageId: messageId ? String(messageId) : null,
      text: String(text),
      senderId: String(senderId),
      senderName: String(senderName || 'Unknown User'),
      senderType: senderType === 'healer' ? 'healer' : 'seeker',
      receiverId: receiverId ? String(receiverId) : null,
      receiverName: receiverName ? String(receiverName) : null,
      bookingPaymentStatus: bookingPaymentStatus ? String(bookingPaymentStatus) : null,
      severity: detection.severity,
      categories: detection.categories,
      matches: detection.matches,
      status: 'open',
      adminNotes: '',
      actionTaken: 'none',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await addDoc(collection(db, RED_FLAGS_COLLECTION), alertPayload);

    return res.status(201).json({
      success: true,
      flagged: true,
      alertId: docRef.id,
      severity: detection.severity,
      categories: detection.categories,
      warningMessage: detection.warningMessage,
    });
  } catch (error) {
    console.error('❌ Error scanning message for red flags:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to scan message for red flags',
    });
  }
}

/**
 * GET /api/moderation/red-flags
 * Lists red-flag alerts with optional filtering and summary counts.
 */
async function listRedFlags(req, res) {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database not initialized',
      });
    }

    const { status, severity, category, senderType, search } = req.query || {};

    const snapshot = await getDocs(collection(db, RED_FLAGS_COLLECTION));
    let alerts = snapshot.docs.map((d) => serializeAlert(d.id, d.data()));

    // Sort newest first
    alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Compute overall summary before filtering
    const summary = {
      open: alerts.filter((a) => a.status === 'open').length,
      highSeverity: alerts.filter((a) => a.severity === 'high' && a.status === 'open').length,
      total: alerts.length,
      resolved: alerts.filter((a) => a.status !== 'open').length,
    };

    if (status && status !== 'all') {
      const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        alerts = alerts.filter((a) => statuses.includes(a.status));
      }
    }

    if (severity && severity !== 'all') {
      alerts = alerts.filter((a) => a.severity === severity);
    }

    if (category && category !== 'all') {
      alerts = alerts.filter((a) => a.categories.includes(category));
    }

    if (senderType && senderType !== 'all') {
      alerts = alerts.filter((a) => a.senderType === senderType);
    }

    if (search && String(search).trim()) {
      const q = String(search).toLowerCase().trim();
      alerts = alerts.filter(
        (a) =>
          a.senderName.toLowerCase().includes(q) ||
          a.bookingId.toLowerCase().includes(q) ||
          a.text.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q)
      );
    }

    return res.status(200).json({
      success: true,
      alerts,
      total: alerts.length,
      summary,
    });
  } catch (error) {
    console.error('❌ Error listing red flags:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list red flags',
    });
  }
}

/**
 * GET /api/moderation/red-flags/summary
 * Lightweight summary for sidebar badge polling.
 */
async function getRedFlagsSummary(req, res) {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database not initialized',
      });
    }

    const q = query(collection(db, RED_FLAGS_COLLECTION), where('status', '==', 'open'));
    const snapshot = await getDocs(q);
    let openCount = 0;
    let highSeverityCount = 0;

    snapshot.forEach((d) => {
      openCount += 1;
      if (d.data()?.severity === 'high') {
        highSeverityCount += 1;
      }
    });

    return res.status(200).json({
      success: true,
      openCount,
      highSeverityCount,
      hasOpen: openCount > 0,
    });
  } catch (error) {
    console.error('❌ Error fetching red flags summary:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch red flags summary',
    });
  }
}

/**
 * PATCH /api/moderation/red-flags/:id
 * Updates status, admin notes, and action taken on a red-flag alert.
 */
async function updateRedFlag(req, res) {
  try {
    const { id } = req.params;
    const { status, adminNotes, actionTaken, reviewedBy } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, error: 'Alert ID is required' });
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    if (actionTaken && !VALID_ACTIONS.includes(actionTaken)) {
      return res.status(400).json({
        success: false,
        error: `Invalid actionTaken. Must be one of: ${VALID_ACTIONS.join(', ')}`,
      });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const alertRef = doc(db, RED_FLAGS_COLLECTION, id);
    const snap = await getDoc(alertRef);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Red flag alert not found' });
    }

    const now = new Date().toISOString();
    const updates = { updatedAt: now };

    if (status) updates.status = status;
    if (typeof adminNotes === 'string') updates.adminNotes = adminNotes;
    if (actionTaken) updates.actionTaken = actionTaken;
    if (reviewedBy) {
      updates.reviewedBy = reviewedBy;
      updates.reviewedAt = now;
    } else if (status && status !== 'open') {
      updates.reviewedAt = now;
    }

    await updateDoc(alertRef, updates);

    const updatedSnap = await getDoc(alertRef);
    return res.status(200).json({
      success: true,
      alert: serializeAlert(updatedSnap.id, updatedSnap.data()),
    });
  } catch (error) {
    console.error('❌ Error updating red flag:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update red flag alert',
    });
  }
}

/**
 * DELETE /api/moderation/red-flags/:id
 */
async function deleteRedFlag(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Alert ID is required' });
    }

    const db = getDatabase();
    if (!db) {
      return res.status(503).json({ success: false, error: 'Database not initialized' });
    }

    const alertRef = doc(db, RED_FLAGS_COLLECTION, id);
    const snap = await getDoc(alertRef);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Red flag alert not found' });
    }

    await deleteDoc(alertRef);
    return res.status(200).json({ success: true, id });
  } catch (error) {
    console.error('❌ Error deleting red flag:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete red flag alert',
    });
  }
}

module.exports = {
  scanAndFlagMessage,
  listRedFlags,
  getRedFlagsSummary,
  updateRedFlag,
  deleteRedFlag,
};
