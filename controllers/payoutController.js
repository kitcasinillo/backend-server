const { getStripe } = require('../config/stripe');
const { getHealerStripeAccount } = require('../utils/stripeConnect');

// GET /api/payouts/balance/:healerId
const getHealerBalance = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Stripe service not configured' });
    }

    const { healerId } = req.params;
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'Healer ID is required' });
    }

    const accountId = await getHealerStripeAccount(healerId);
    if (!accountId) {
      return res.status(404).json({ success: false, error: 'Stripe Connect account not found' });
    }

    // Retrieve connected account details and balance
    const account = await stripe.accounts.retrieve(accountId);
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId });

    // Normalize available/pending by currency
    const summarize = (arr = []) => {
      const out = {};
      for (const b of arr) {
        const cur = (b.currency || 'usd').toLowerCase();
        out[cur] = (out[cur] || 0) + (Number(b.amount) || 0);
      }
      return out;
    };

    res.json({
      success: true,
      accountId,
      payoutsEnabled: !!account.payouts_enabled,
      chargesEnabled: !!account.charges_enabled,
      detailsSubmitted: !!account.details_submitted,
      available: summarize(balance.available),
      pending: summarize(balance.pending),
    });
  } catch (error) {
    console.error('❌ Error getting healer balance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/payouts/create
// body: { healerId, amountCents, currency }
const createPayout = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Stripe service not configured' });
    }

    const { healerId, amountCents, currency = 'usd' } = req.body || {};
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'Healer ID is required' });
    }

    const accountId = await getHealerStripeAccount(healerId);
    if (!accountId) {
      return res.status(404).json({ success: false, error: 'Stripe Connect account not found' });
    }

    const account = await stripe.accounts.retrieve(accountId);
    if (!account.payouts_enabled) {
      return res.status(400).json({ success: false, error: 'Payouts are not enabled for this account' });
    }

    // Validate balance availability
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
    const availableByCurrency = (balance.available || []).reduce((acc, b) => {
      const cur = (b.currency || 'usd').toLowerCase();
      acc[cur] = (acc[cur] || 0) + (Number(b.amount) || 0);
      return acc;
    }, {});

    const cur = String(currency || 'usd').toLowerCase();
    const toPay = Number(amountCents || 0);
    const available = Number(availableByCurrency[cur] || 0);

    if (!Number.isFinite(toPay) || toPay <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid payout amount' });
    }
    if (toPay > available) {
      return res.status(400).json({ success: false, error: 'Insufficient available balance for payout' });
    }

    // Create payout to the connected account
    const payout = await stripe.payouts.create(
      { amount: Math.floor(toPay), currency: cur },
      { stripeAccount: accountId }
    );

    res.json({ success: true, payoutId: payout.id, status: payout.status });
  } catch (error) {
    console.error('❌ Error creating payout:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/payouts/history/:healerId
const listPayouts = async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(500).json({ success: false, error: 'Stripe service not configured' });
    }

    const { healerId } = req.params;
    if (!healerId) {
      return res.status(400).json({ success: false, error: 'Healer ID is required' });
    }

    const accountId = await getHealerStripeAccount(healerId);
    if (!accountId) {
      return res.status(404).json({ success: false, error: 'Stripe Connect account not found' });
    }

    const payouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: accountId });
    res.json({ success: true, payouts: payouts.data || [] });
  } catch (error) {
    console.error('❌ Error listing payouts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getHealerBalance,
  createPayout,
  listPayouts,
};