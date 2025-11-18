const { getDatabase } = require('../config/database');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const COLLECTION = 'payout_settings';

const getPayoutSettings = async (req, res) => {
  try {
    const healerId = req.params.healerId;
    if (!healerId) return res.status(400).json({ success: false, error: 'Missing healerId' });
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });
    const ref = doc(db, COLLECTION, healerId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.json({ success: true, settings: null });
    }
    return res.json({ success: true, settings: snap.data() });
  } catch (e) {
    console.error('Error fetching payout settings:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};

const savePayoutSettings = async (req, res) => {
  try {
    const { healerId, method_type, paypal_email, payout_notes,
      bank_account_holder_name, bank_name, iban, account_number, routing_number, swift_bic, country, currency,
      wise_recipient_id, wise_email } = req.body || {};
    if (!healerId) return res.status(400).json({ success: false, error: 'Missing healerId' });
    if (!method_type) return res.status(400).json({ success: false, error: 'Missing method_type' });

    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const ref = doc(db, COLLECTION, healerId);
    const now = new Date().toISOString();
    const payload = {
      healerId,
      method_type,
      paypal_email: paypal_email || null,
      wise_recipient_id: wise_recipient_id || null,
      wise_email: wise_email || null,
      payout_notes: payout_notes || null,
      updated_at: now,
    };
    // Add bank transfer fields if provided
    const hasBankFields = bank_account_holder_name || bank_name || iban || account_number || routing_number || swift_bic || country || currency;
    if (hasBankFields) {
      payload.bank = {
        account_holder_name: bank_account_holder_name || null,
        bank_name: bank_name || null,
        iban: iban || null,
        account_number: account_number || null,
        routing_number: routing_number || null,
        swift_bic: swift_bic || null,
        country: country || null,
        currency: currency || null,
      };
    }
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      payload.created_at = now;
    }
    await setDoc(ref, payload, { merge: true });
    return res.json({ success: true, settings: payload });
  } catch (e) {
    console.error('Error saving payout settings:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};

module.exports = { getPayoutSettings, savePayoutSettings };