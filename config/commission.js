// Commission configuration
const COMMISSION_CONFIG = {
  HEALER_COMMISSION_PERCENT: 10, // 10% from healer
  SEEKER_FEE_PERCENT: 5, // 5% additional fee for seeker
  PROCESSING_FEE_PERCENT: 2.9, // Stripe processing fee (2.9% + 30¢)
  PROCESSING_FEE_FIXED: 30 // 30 cents fixed fee
};

module.exports = COMMISSION_CONFIG;
