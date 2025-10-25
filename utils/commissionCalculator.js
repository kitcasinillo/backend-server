const COMMISSION_CONFIG = require('../config/commission');

// Helper functions for commission calculations
function calculateCommissionBreakdown(baseAmount) {
  const healerCommission = Math.round(baseAmount * (COMMISSION_CONFIG.HEALER_COMMISSION_PERCENT / 100));
  const seekerFee = Math.round(baseAmount * (COMMISSION_CONFIG.SEEKER_FEE_PERCENT / 100));
  const processingFeePercent = Math.round((baseAmount + seekerFee) * (COMMISSION_CONFIG.PROCESSING_FEE_PERCENT / 100));
  const totalProcessingFee = processingFeePercent + COMMISSION_CONFIG.PROCESSING_FEE_FIXED;
  
  const totalAmount = baseAmount + seekerFee + totalProcessingFee;
  const healerPayout = baseAmount - healerCommission;
  
  return {
    baseAmount,
    healerCommission,
    seekerFee,
    processingFee: totalProcessingFee,
    totalAmount,
    healerPayout,
    platformRevenue: healerCommission + seekerFee
  };
}

module.exports = {
  calculateCommissionBreakdown
};
