const { collection, getDocs, query, orderBy, where } = require('firebase/firestore');
const { getDatabase } = require('../config/database');
const { calculateCommissionBreakdown } = require('../utils/commissionCalculator');

const getRevenueStats = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { timeRange = 'month', startDate: customStart, endDate: customEnd } = req.query;

    // 1. Fetch all bookings
    const bookingsSnap = await getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc')));
    
    // 2. Fetch all premium healers
    const premiumHealersSnap = await getDocs(query(collection(db, 'profiles'), where('subscription_type', '==', 'premium')));

    // Calculate start date based on range
    const now = new Date();
    let startDate = new Date(0); // Default to all time

    if (timeRange === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (timeRange === 'week') {
      const tempDate = new Date(now);
      const dayOfWeek = tempDate.getDay();
      const diff = tempDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      startDate = new Date(tempDate.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === 'custom' && customStart) {
      startDate = new Date(customStart);
    }

    let endDate = new Date();
    if (timeRange === 'custom' && customEnd) {
      endDate = new Date(customEnd);
      endDate.setHours(23, 59, 59, 999);
    }

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    let totalGrossBookingVolume = 0;
    let totalPlatformRevenue = 0;
    let netPlatformRevenue = 0;
    let sessionCommissions = 0;
    let retreatPlatformFees = 0;
    let totalPremiumRevenue = 0;

    const chartDataMap = new Map();

    // Process Bookings
    bookingsSnap.docs.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt || data.created_at;
      
      if (createdAt && createdAt >= startIso && createdAt <= endIso) {
        // Assume non-failed bookings
        if (data.paymentStatus === 'succeeded' || (typeof data.status === 'string' && data.status !== 'failed' && data.status !== 'cancelled')) {
          const amount = Number(data.amount || 0);
          const breakdown = calculateCommissionBreakdown(amount);

          totalGrossBookingVolume += breakdown.totalAmount;
          totalPlatformRevenue += breakdown.platformRevenue;
          netPlatformRevenue += (breakdown.platformRevenue - breakdown.processingFee);

          const isRetreat = (
            (typeof data.bookingType === 'string' && data.bookingType.toLowerCase() === 'retreat') ||
            (typeof data.type === 'string' && data.type.toLowerCase() === 'retreat') ||
            !!data.retreatListingId ||
            (data.bookingType !== 'session' && (
              (typeof data.format === 'string' && data.format.toLowerCase().includes('retreat')) ||
              (typeof data.modality === 'string' && data.modality.toLowerCase().includes('retreat')) ||
              (typeof data.listingTitle === 'string' && data.listingTitle.toLowerCase().includes('retreat'))
            ))
          );

          if (isRetreat) {
            retreatPlatformFees += breakdown.platformRevenue;
          } else {
            sessionCommissions += breakdown.platformRevenue;
          }

          // Aggregating for chart
          const dateKey = createdAt.split('T')[0];
          const existing = chartDataMap.get(dateKey) || { revenue: 0, commission: 0 };
          chartDataMap.set(dateKey, {
            revenue: existing.revenue + breakdown.totalAmount,
            commission: existing.commission + breakdown.platformRevenue
          });
        }
      }
    });

    // Process Premium Subscriptions
    const PREMIUM_PRICE = 120; // Hardcoded as per frontend suggestion
    premiumHealersSnap.docs.forEach(doc => {
      const data = doc.data();
      const activatedAt = data.premium_activated_at;
      
      if (activatedAt && activatedAt >= startIso && activatedAt <= endIso) {
        totalPremiumRevenue += PREMIUM_PRICE;
        totalPlatformRevenue += PREMIUM_PRICE;
        netPlatformRevenue += PREMIUM_PRICE; // Assuming no processing fee for now or simplified

        // Aggregating for chart
        const dateKey = activatedAt.split('T')[0];
        const existing = chartDataMap.get(dateKey) || { revenue: 0, commission: 0 };
        chartDataMap.set(dateKey, {
          revenue: existing.revenue + PREMIUM_PRICE,
          commission: existing.commission + PREMIUM_PRICE
        });
      }
    });

    // Format chart data
    const chartData = [];
    // If we want a range of dates even without data, we should fill gaps.
    // For now, let's just return what we have sorted by date.
    Array.from(chartDataMap.keys()).sort().forEach(date => {
      chartData.push({
        name: date,
        ...chartDataMap.get(date)
      });
    });

    // If no chart data, provide a fallback to avoid frontend issues
    if (chartData.length === 0) {
        chartData.push({ name: new Date().toISOString().split('T')[0], revenue: 0, commission: 0 });
    }

    return res.json({
      success: true,
      stats: {
        totalPlatformRevenue,
        netPlatformRevenue,
        totalGrossBookingVolume,
        totalPremiumRevenue,
        distribution: {
          sessionCommissions,
          premiumSubscriptions: totalPremiumRevenue,
          retreatPlatformFees
        },
        chartData
      }
    });
  } catch (error) {
    console.error('❌ Error fetching revenue stats:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getCommissionReport = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const bookingsSnap = await getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc')));
    
    const records = bookingsSnap.docs.map(doc => {
      const data = doc.data();
      const amount = Number(data.amount || 0);
      const breakdown = calculateCommissionBreakdown(amount);

      return {
        id: doc.id,
        bookingId: doc.id.substring(0, 8).toUpperCase(),
        date: data.createdAt ? data.createdAt.split('T')[0] : 'N/A',
        healerName: data.healerName || 'Unknown',
        seekerName: data.seekerName || 'Unknown',
        baseAmount: amount,
        healerCommission: breakdown.healerCommission,
        seekerFee: breakdown.seekerFee,
        processingFee: breakdown.processingFee,
        healerPayout: breakdown.healerPayout,
        platformNet: breakdown.platformRevenue - breakdown.processingFee,
        stripePiId: data.paymentIntentId || 'N/A',
        status: data.paymentStatus === 'succeeded' ? 'Processed' : 'Pending'
      };
    });

    return res.json({
      success: true,
      records
    });
  } catch (error) {
    console.error('❌ Error fetching commission report:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getPremiumSubscriptions = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const premiumHealersSnap = await getDocs(query(collection(db, 'profiles'), where('subscription_type', '==', 'premium')));
    
    const subscriptions = premiumHealersSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        healerName: data.displayName || data.name || 'Unknown',
        email: data.email || 'N/A',
        activatedAt: data.premium_activated_at ? data.premium_activated_at.split('T')[0] : 'N/A',
        amountPaid: 120, // Static for now as per system design
        stripeId: 'SUBS_' + doc.id.substring(0, 8),
        status: 'Active'
      };
    });

    return res.json({
      success: true,
      subscriptions
    });
  } catch (error) {
    console.error('❌ Error fetching premium subscriptions:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getRevenueStats,
  getCommissionReport,
  getPremiumSubscriptions
};
