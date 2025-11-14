const express = require('express');
const { sendEvent, ping } = require('../utils/n8n');

const router = express.Router();

// Ping n8n configuration
router.get('/n8n/ping', async (req, res) => {
  try {
    const result = await ping();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send custom test event to n8n
router.post('/n8n/test', async (req, res) => {
  try {
    const { event = 'test.event', payload = {} } = req.body || {};
    const result = await sendEvent(event, payload, { meta: { source: 'backend:test' } });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Emit account.signup event (matches requested JSON shape)
router.post('/n8n/account-signup', async (req, res) => {
  try {
    const { userId, email, name, role } = req.body || {};
    if (!userId || !email || !name) {
      return res.status(400).json({ success: false, error: 'userId and email are required' });
    }
    const result = await sendEvent('account.signup', {
      userId,
      name,
      email,
      role,
    }, { meta: { source: 'backend:n8nRoutes' } });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Emit session.reminder event (matches requested JSON shape)
router.post('/n8n/session-reminder', async (req, res) => {
  try {
    const { bookingId, seeker, healer, sessionDate, timezone } = req.body || {};
    if (!bookingId || !seeker?.email || !healer?.email || !sessionDate || !timezone) {
      return res.status(400).json({ success: false, error: 'bookingId, seeker.email, healer.email, sessionDate, timezone are required' });
    }
    const result = await sendEvent('session.reminder', {
      bookingId,
      seeker,
      healer,
      sessionDate,
      timezone,
    }, { meta: { source: 'backend:n8nRoutes' } });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Emit retreat.booking event (matches requested JSON shape)
router.post('/n8n/retreat-booking', async (req, res) => {
  try {
    const { retreatId, title, seeker, healer, location, dates, price } = req.body || {};
    if (!retreatId || !title || !seeker?.email || !healer?.email || !price?.amount || !price?.currency) {
      return res.status(400).json({ success: false, error: 'retreatId, title, seeker.email, healer.email, price.amount, price.currency are required' });
    }
    const result = await sendEvent('retreat.booking', {
      retreatId,
      title,
      seeker,
      healer,
      location,
      dates,
      price,
    }, { meta: { source: 'backend:n8nRoutes' } });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;