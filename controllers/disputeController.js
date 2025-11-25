const { getDatabase } = require('../config/database');
const { sendEvent } = require('../utils/n8n');
const {
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  getDocs
} = require('firebase/firestore');

// Map textual outcome to status key
const outcomeStatusMap = {
  refund: 'resolved_refunded',
  partial_refund: 'resolved_partial_refund',
  credit: 'resolved_credit',
  deny: 'denied'
};

// Helper to resolve a user's display name from profile
async function resolveProfileName(db, userId) {
  try {
    if (!db || !userId) return null;
    const ref = doc(db, 'profiles', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data() || {};
    const first = d.first_name || '';
    const last = d.last_name || '';
    const full = `${first} ${last}`.trim();
    return full || d.display_name || d.name || null;
  } catch (e) {
    console.warn('⚠️ Failed to resolve profile name for', userId, e?.message || e);
    return null;
  }
}

// Helper: basic validation
function requireFields(obj, fields) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
}

// POST /api/disputes
const createDispute = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const body = req.body || {};
    requireFields(body, ['bookingId', 'seekerId', 'healerId', 'type', 'description']);

    const nowIso = new Date().toISOString();
    const requestedAmount = body.requestedAmount || 0;
    const currency = body.currency || 'USD';
    const severity = body.severity || (body.type === 'safety' ? 'safety' : 'normal');

    const disputeData = {
      bookingId: body.bookingId,
      seekerId: body.seekerId,
      healerId: body.healerId,
      type: body.type,
      status: 'open',
      severity,
      description: body.description,
      requestedAmount,
      currency,
      evidence: Array.isArray(body.evidence) ? body.evidence : [],
      submittedAt: nowIso,
      responseDueAt: body.responseDueAt || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      decisionDueAt: body.decisionDueAt || new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      seekerEmail: body.seekerEmail || null,
      healerEmail: body.healerEmail || null,
      payments: body.payments || {},
      audit: { createdAt: nowIso, createdBy: body.seekerId }
    };

    const disputesRef = collection(db, 'disputes');
    const createdRef = await addDoc(disputesRef, disputeData);

    // Emit webhook event for email notification / workflow
    try {
      // Resolve names to include in payload
      const [seekerName, healerName] = await Promise.all([
        resolveProfileName(db, disputeData.seekerId),
        resolveProfileName(db, disputeData.healerId),
      ]);

      await sendEvent('dispute.created', {
        id: createdRef.id,
        bookingId: disputeData.bookingId,
        type: disputeData.type,
        severity: disputeData.severity,
        status: disputeData.status,
        seekerName: seekerName || null,
        healerName: healerName || null,
        seeker: { id: disputeData.seekerId, email: disputeData.seekerEmail },
        healer: { id: disputeData.healerId, email: disputeData.healerEmail },
        requestedAmount: disputeData.requestedAmount,
        currency: disputeData.currency,
        submittedAt: disputeData.submittedAt,
        description: disputeData.description
      }, { meta: { source: 'backend:disputeController' } });
    } catch (n8nErr) {
      console.warn('⚠️ Failed to emit dispute.created:', n8nErr?.message || n8nErr);
    }

    return res.json({ success: true, id: createdRef.id, dispute: disputeData });
  } catch (err) {
    console.error('❌ Error creating dispute:', err);
    const code = err.statusCode || 500;
    res.status(code).json({ success: false, error: err.message });
  }
};

// GET /api/disputes/:id
const getDispute = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const id = req.params.id;
    const ref = doc(db, 'disputes', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, id, dispute: snap.data() });
  } catch (err) {
    console.error('❌ Error fetching dispute:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// GET /api/disputes
const listDisputes = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const { status, type, seekerId, healerId } = req.query || {};

    // Build query with filters only to avoid Firestore composite index requirements
    const baseRef = collection(db, 'disputes');
    const filters = [];
    if (status) filters.push(where('status', '==', status));
    if (type) filters.push(where('type', '==', type));
    if (seekerId) filters.push(where('seekerId', '==', seekerId));
    if (healerId) filters.push(where('healerId', '==', healerId));

    const q = filters.length ? query(baseRef, ...filters) : query(baseRef);
    const snap = await getDocs(q);
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Sort in-memory by submittedAt (newest first)
    items.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

    return res.json({ success: true, disputes: items });
  } catch (err) {
    console.error('❌ Error listing disputes:', err);
    // Provide a more helpful hint if index errors occur
    const message = err?.message || 'Unknown error';
    return res.status(500).json({ success: false, error: message });
  }
};

// POST /api/disputes/:id/evidence
const addEvidence = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const id = req.params.id;
    const { party, evidence } = req.body || {};
    if (!party || !evidence) return res.status(400).json({ success: false, error: 'party and evidence are required' });
    const ref = doc(db, 'disputes', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ success: false, error: 'Not found' });
    const data = snap.data();
    const nowIso = new Date().toISOString();
    const evItem = { party, ...evidence, createdAt: nowIso };
    const updated = { ...data, evidence: [...(data.evidence || []), evItem], updatedAt: nowIso };
    await setDoc(ref, updated, { merge: true });

    try {
      await sendEvent('dispute.updated', {
        id,
        bookingId: data.bookingId,
        status: updated.status,
        type: data.type,
        lastChange: 'evidence_added',
        party,
        evidence: evItem
      }, { meta: { source: 'backend:disputeController' } });
    } catch (n8nErr) {
      console.warn('⚠️ Failed to emit dispute.updated:', n8nErr?.message || n8nErr);
    }

    return res.json({ success: true, id, dispute: updated });
  } catch (err) {
    console.error('❌ Error adding evidence:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/disputes/:id/respond (healer response)
const respond = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const id = req.params.id;
    const { healerStatement, evidence } = req.body || {};
    const ref = doc(db, 'disputes', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ success: false, error: 'Not found' });
    const data = snap.data();
    const nowIso = new Date().toISOString();
    const updated = {
      ...data,
      healerStatement: healerStatement || data.healerStatement || null,
      status: 'in_review',
      updatedAt: nowIso
    };
    if (evidence) {
      updated.evidence = [...(data.evidence || []), { party: 'healer', ...evidence, createdAt: nowIso }];
    }
    await setDoc(ref, updated, { merge: true });

    try {
      await sendEvent('dispute.updated', {
        id,
        bookingId: data.bookingId,
        status: updated.status,
        type: data.type,
        lastChange: 'healer_responded'
      }, { meta: { source: 'backend:disputeController' } });
    } catch (n8nErr) {
      console.warn('⚠️ Failed to emit dispute.updated (healer respond):', n8nErr?.message || n8nErr);
    }

    return res.json({ success: true, id, dispute: updated });
  } catch (err) {
    console.error('❌ Error recording response:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/disputes/:id/decision (moderator)
const decide = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const id = req.params.id;
    const { outcome, refundAmount = 0, creditAmount = 0, notes } = req.body || {};
    if (!outcome || !outcomeStatusMap[outcome]) return res.status(400).json({ success: false, error: 'Invalid or missing outcome' });
    const ref = doc(db, 'disputes', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ success: false, error: 'Not found' });
    const data = snap.data();
    const nowIso = new Date().toISOString();
    const status = outcomeStatusMap[outcome];
    const updated = {
      ...data,
      status,
      decision: { outcome, refundAmount, creditAmount, notes, decidedAt: nowIso },
      updatedAt: nowIso
    };
    await setDoc(ref, updated, { merge: true });

    try {
      const [seekerName, healerName] = await Promise.all([
        resolveProfileName(db, data.seekerId),
        resolveProfileName(db, data.healerId),
      ]);
      await sendEvent('dispute.resolved', {
        id,
        bookingId: data.bookingId,
        type: data.type,
        status,
        decision: updated.decision,
        seekerName: seekerName || null,
        healerName: healerName || null,
        seeker: { id: data.seekerId, email: data.seekerEmail },
        healer: { id: data.healerId, email: data.healerEmail }
      }, { meta: { source: 'backend:disputeController' } });
    } catch (n8nErr) {
      console.warn('⚠️ Failed to emit dispute.resolved:', n8nErr?.message || n8nErr);
    }

    return res.json({ success: true, id, dispute: updated });
  } catch (err) {
    console.error('❌ Error deciding dispute:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/disputes/:id/notify-email (trigger webhook for email notification)
const notifyEmail = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const id = req.params.id;
    const ref = doc(db, 'disputes', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return res.status(404).json({ success: false, error: 'Not found' });
    const d = snap.data();

    const [seekerName, healerName] = await Promise.all([
      resolveProfileName(db, d.seekerId),
      resolveProfileName(db, d.healerId),
    ]);
    const payload = {
      id,
      bookingId: d.bookingId,
      type: d.type,
      status: d.status,
      severity: d.severity,
      requestedAmount: d.requestedAmount,
      currency: d.currency,
      seekerName: seekerName || null,
      healerName: healerName || null,
      seeker: { id: d.seekerId, email: d.seekerEmail },
      healer: { id: d.healerId, email: d.healerEmail },
      submittedAt: d.submittedAt,
      decision: d.decision || null
    };
    const result = await sendEvent('dispute.email', payload, { meta: { source: 'backend:disputeController' } });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('❌ Error notifying email webhook:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  createDispute,
  getDispute,
  listDisputes,
  addEvidence,
  respond,
  decide,
  notifyEmail
};