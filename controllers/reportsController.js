const {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  getCountFromServer,
} = require('firebase/firestore');
const { getDatabase } = require('../config/database');

/**
 * Safely converts any Firestore timestamp format to an ISO string.
 * Handles: Firestore Timestamp objects, {seconds} objects, Date objects, and strings.
 */
const toIsoOrNull = (value) => {
  if (!value) return null;
  
  // If already a string, validate it's a valid date
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  
  // Handle Date objects
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  
  // Handle Firestore Timestamps
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  
  // Handle {seconds} objects
  if (typeof value?.seconds === 'number') {
    const d = new Date(value.seconds * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  
  return null;
};

/**
 * Standardized date grouping helper
 */
const getDateKey = (iso, gran) => {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'N/A';
  
  if (gran === 'Weekly') {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
  }
  if (gran === 'Monthly') return iso.substring(0, 7);
  return iso.split('T')[0];
};

/**
 * Get user report data including registration trends, churn, funnels, and retention
 */
const getUserReportData = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res
        .status(500)
        .json({ success: false, error: 'Database not initialized' });
    }

    const { startDate, endDate, granularity = 'Daily', range = 'This Month' } = req.query;
    
    const now = new Date();
    let startIso, endIso;
    
    if (startDate && endDate && startDate !== "" && endDate !== "") {
      try {
        startIso = new Date(startDate).toISOString();
        endIso = new Date(endDate).toISOString();
      } catch (e) {
        endIso = now.toISOString();
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    } else {
      endIso = now.toISOString();

      if (range === 'Today') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Week') {
        // Last 8 weeks for meaningful weekly charts
        const start = new Date();
        start.setDate(now.getDate() - 56);
        start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Month') {
        // Last 12 months for meaningful monthly charts
        const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        startIso = start.toISOString();
      } else {
        // Default: last 30 days
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        startIso = start.toISOString();
      }
    }

    console.log(`[Reports] Range: ${range}, Granularity: ${granularity}, Window: ${startIso} -> ${endIso}`);

    // =====================================================
    // 1. Fetch all profiles once
    // =====================================================
    const profilesSnap = await getDocs(collection(db, 'profiles'));
    const allProfiles = profilesSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        role: data.role,
        createdAt: toIsoOrNull(data.created_at || data.createdAt) || null,
        lastActivityAt: toIsoOrNull(data.lastActivityAt || data.last_activity_at) || null,
        onboardingComplete: !!data.onboardingComplete,
        listingsCount: Number(data.listingsCount || 0),
        bookingsCount: Number(data.bookingsCount || 0),
        isPremium: !!(data.isPremium || data.is_premium),
        profileComplete: !!(data.profileComplete || data.profile_complete),
        searchCount: Number(data.searchCount || data.search_count || 0),
      };
    });

    console.log(`[Reports] Total profiles: ${allProfiles.length}, With createdAt: ${allProfiles.filter(p => p.createdAt).length}`);

    // =====================================================
    // 2. Registration Trend (date-filtered + grouped)
    // =====================================================
    const profilesByDate = {};

    allProfiles.forEach((profile) => {
      if (!profile.createdAt) return;

      // ISO string comparison (same pattern as dashboardController)
      if (profile.createdAt >= startIso && profile.createdAt <= endIso) {
        let dateKey = '';
        const createdDate = new Date(profile.createdAt);

        if (granularity === 'Weekly') {
          // Group by the start of the week (Monday)
          const d = new Date(createdDate);
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          d.setDate(diff);
          dateKey = d.toISOString().split('T')[0];
        } else if (granularity === 'Monthly') {
          dateKey = profile.createdAt.substring(0, 7); // YYYY-MM
        } else {
          dateKey = profile.createdAt.split('T')[0]; // YYYY-MM-DD (Daily)
        }

        if (!profilesByDate[dateKey]) {
          profilesByDate[dateKey] = { seekers: 0, healers: 0 };
        }

        if (profile.role === 'healer') {
          profilesByDate[dateKey].healers++;
        } else if (profile.role === 'seeker') {
          profilesByDate[dateKey].seekers++;
        }
      }
    });

    const registrationArray = Object.entries(profilesByDate)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, data]) => ({
        name: date,
        seekers: data.seekers,
        healers: data.healers,
      }));

    console.log(`[Reports] Registration data points: ${registrationArray.length}`);

    // =====================================================
    // 3. Churn Indicators (uses date-filtered profiles)
    // =====================================================
    const nowMs = now.getTime();
    const inactivityThresholds = [
      { days: 30, label: '30 Days Inactive' },
      { days: 60, label: '60 Days Inactive' },
      { days: 90, label: '90 Days Inactive' },
    ];

    // Filter profiles in the date range for churn analysis
    const profilesInRange = allProfiles.filter(
      (p) => p.createdAt && p.createdAt >= startIso && p.createdAt <= endIso
    );

    const churnIndicators = inactivityThresholds.map((threshold) => {
      const cutoffDate = new Date(nowMs - threshold.days * 24 * 60 * 60 * 1000).toISOString();

      let inactiveHealers = 0;
      let inactiveSeekers = 0;

      profilesInRange.forEach((profile) => {
        const lastActivity = profile.lastActivityAt || profile.createdAt;
        if (lastActivity && lastActivity < cutoffDate) {
          if (profile.role === 'healer') inactiveHealers++;
          if (profile.role === 'seeker') inactiveSeekers++;
        }
      });

      return {
        name: threshold.label,
        healers: inactiveHealers,
        seekers: inactiveSeekers,
      };
    });

    // =====================================================
    // 4. Funnel Data (uses date-filtered profiles)
    // =====================================================
    const healersInRange = profilesInRange.filter((p) => p.role === 'healer');
    const seekersInRange = profilesInRange.filter((p) => p.role === 'seeker');

    const healerFunnel = [
      { step: 'Registered', value: healersInRange.length },
      { step: 'Onboarding Complete', value: healersInRange.filter((h) => h.onboardingComplete).length },
      { step: 'First Listing', value: healersInRange.filter((h) => h.listingsCount > 0).length },
      { step: 'First Booking', value: healersInRange.filter((h) => h.bookingsCount > 0).length },
      { step: 'Premium Upgrade', value: healersInRange.filter((h) => h.isPremium).length },
    ];

    const seekerFunnel = [
      { step: 'Registered', value: seekersInRange.length },
      { step: 'Profile Complete', value: seekersInRange.filter((s) => s.profileComplete).length },
      { step: 'First Search', value: seekersInRange.filter((s) => s.searchCount > 0).length },
      { step: 'First Booking', value: seekersInRange.filter((s) => s.bookingsCount > 0).length },
      { step: 'Repeat Booking', value: seekersInRange.filter((s) => s.bookingsCount > 1).length },
    ];

    // =====================================================
    // 5. Subscription Cohort (date-filtered bookings)
    // =====================================================
    const bookingsSnap = await getDocs(collection(db, 'bookings'));
    const subscriptionsByPeriod = {};

    bookingsSnap.docs.forEach((doc) => {
      const data = doc.data();
      const bookingDate = toIsoOrNull(data.created_at || data.createdAt);
      if (!bookingDate) return;

      // Only include bookings in the date range
      if (bookingDate >= startIso && bookingDate <= endIso) {
        const periodKey = getDateKey(bookingDate, granularity);

        if (!subscriptionsByPeriod[periodKey]) {
          subscriptionsByPeriod[periodKey] = { total: 0, subscribed: 0 };
        }
        subscriptionsByPeriod[periodKey].total++;
        if (data.subscriptionType || data.isSubscribed) {
          subscriptionsByPeriod[periodKey].subscribed++;
        }
      }
    });

    const subscriptionCohort = Object.entries(subscriptionsByPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        rate: data.total > 0
          ? parseFloat(((data.subscribed / data.total) * 100).toFixed(1))
          : 0,
      }));

    // =====================================================
    // 6. Retention Data (cohort analysis - date-filtered)
    // =====================================================
    const cohortData = {};

    profilesInRange.forEach((profile) => {
      if (!profile.createdAt) return;
      const cohortMonth = profile.createdAt.substring(0, 7); // YYYY-MM

      if (!cohortData[cohortMonth]) {
        cohortData[cohortMonth] = [];
      }
      cohortData[cohortMonth].push({
        userId: profile.id,
        createdAt: new Date(profile.createdAt),
        lastActivityAt: profile.lastActivityAt
          ? new Date(profile.lastActivityAt)
          : new Date(profile.createdAt),
      });
    });

    const retentionData = Object.entries(cohortData)
      .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
      .map(([month, users]) => {
        const cohortDate = new Date(month + '-01');
        let m1 = 0;
        let m2 = 0;
        let m3 = 0;

        users.forEach((user) => {
          const monthsActive = Math.floor(
            (user.lastActivityAt - cohortDate) / (30 * 24 * 60 * 60 * 1000)
          );
          if (monthsActive >= 1) m1++;
          if (monthsActive >= 2) m2++;
          if (monthsActive >= 3) m3++;
        });

        const totalUsers = users.length;
        return {
          cohort: month,
          users: totalUsers,
          m0: 100,
          m1: totalUsers > 0 ? Math.round((m1 / totalUsers) * 100) : null,
          m2: totalUsers > 0 ? Math.round((m2 / totalUsers) * 100) : null,
          m3: totalUsers > 0 ? Math.round((m3 / totalUsers) * 100) : null,
        };
      });

    // =====================================================
    // 7. Summary Metrics (based on filtered data)
    // =====================================================
    const totalNewInRange = registrationArray.reduce(
      (sum, day) => sum + day.seekers + day.healers, 0
    );
    const newHealersInRange = registrationArray.reduce(
      (sum, day) => sum + day.healers, 0
    );
    const conversionRate = healersInRange.length > 0
      ? ((healersInRange.filter((h) => h.bookingsCount > 0).length / healersInRange.length) * 100).toFixed(1)
      : '0.0';

    const atRiskCount = churnIndicators.find((c) => c.name === '30 Days Inactive');
    const atRiskUsers = atRiskCount ? atRiskCount.healers + atRiskCount.seekers : 0;

    const summaryData = [
      {
        title: `New Healers (${granularity})`,
        value: `+${newHealersInRange}`,
        description: `Total for selected ${granularity.toLowerCase()} period`,
      },
      {
        title: 'Conversion Rate',
        value: `${conversionRate}%`,
        description: 'Healer conversions',
      },
      {
        title: 'At Risk Users',
        value: atRiskUsers.toString(),
        description: `Trends for ${granularity}`,
      },
      {
        title: 'Avg. LTV',
        value: '$420.50',
        description: 'Estimated value',
      },
    ];

    return res.status(200).json({
      success: true,
      data: {
        summary: summaryData,
        registration: registrationArray,
        churn: churnIndicators,
        healerFunnel,
        seekerFunnel,
        subscriptionCohort,
        retentionData,
      },
    });
  } catch (error) {
    console.error('Error fetching user report data:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch user report data',
    });
  }
};

/**
 * Get retreat report data including trends, revenue, locations, pricing, and performance
 */
const getRetreatReportData = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const { startDate, endDate, granularity = 'Monthly', range = 'This Month' } = req.query;

    // Calculate date window as ISO strings
    let startIso, endIso;
    const now = new Date();

    if (startDate && endDate) {
      startIso = new Date(startDate).toISOString();
      endIso = new Date(endDate).toISOString();
    } else {
      endIso = now.toISOString();
      if (range === 'Today') {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Week') {
        const start = new Date(); start.setDate(now.getDate() - 56); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Month') {
        startIso = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();
      } else {
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    console.log(`[RetreatReport] Range: ${range}, Granularity: ${granularity}, Window: ${startIso} -> ${endIso}`);

    // =====================================================
    // 1. Fetch all retreat listings
    // =====================================================
    const retreatSnap = await getDocs(collection(db, 'retreat_listings'));
    const allRetreats = retreatSnap.docs.map((d) => {
      const data = d.data();
      const createdAt = toIsoOrNull(data.createdAt || data.created_at) || null;
      const sDate = toIsoOrNull(data.startDate || data.start_date) || null;
      const eDate = toIsoOrNull(data.endDate || data.end_date) || null;
      const price = Number(data.pricePerPerson || data.price || 0);
      const capacity = Math.max(0, Number(data.maxParticipants || data.capacity || 0));
      const bookedSpots = Math.max(0, Number(data.bookedSpots || data.booked_spots || data.participantsBooked || 0));
      const status = String(data.status || 'draft').toLowerCase();

      // Calculate duration in days
      let durationDays = 0;
      if (sDate && eDate) {
        durationDays = Math.max(1, Math.ceil((new Date(eDate) - new Date(sDate)) / (24 * 60 * 60 * 1000)));
      }

      return {
        id: d.id,
        title: data.title || data.name || 'Untitled Retreat',
        location: data.location || data.city || data.country || 'Unknown',
        createdAt,
        startDate: sDate,
        endDate: eDate,
        price,
        capacity,
        bookedSpots,
        status,
        durationDays,
        isActive: ['active', 'approved', 'published', 'live'].includes(status),
      };
    });

    // Filter retreats within date range (by createdAt)
    const retreatsInRange = allRetreats.filter(
      (r) => r.createdAt && r.createdAt >= startIso && r.createdAt <= endIso
    );

    console.log(`[RetreatReport] Total retreats: ${allRetreats.length}, In range: ${retreatsInRange.length}`);

    // =====================================================
    // 2. Fetch all bookings for retreat-related data
    // =====================================================
    const bookingsSnap = await getDocs(collection(db, 'bookings'));
    const allBookings = bookingsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        listingId: data.listingId || null,
        amount: Number(data.amount || data.totalAmount || data.price || 0),
        createdAt: toIsoOrNull(data.created_at || data.createdAt) || null,
        format: [data.format, data.modality, data.listingTitle, data.title].filter(Boolean).join(' ').toLowerCase(),
        status: typeof data.status === 'string' ? data.status : (data.status?.state || 'unknown'),
      };
    }).filter((b) => b.format.includes('retreat'));

    // Bookings within range
    const bookingsInRange = allBookings.filter(
      (b) => b.createdAt && b.createdAt >= startIso && b.createdAt <= endIso
    );

    // 3. Active Retreat Count Trend (grouped by granularity)
    const retreatCountByPeriod = {};
    retreatsInRange.forEach((r) => {
      if (!r.createdAt) return;
      const key = getDateKey(r.createdAt, granularity);
      if (!retreatCountByPeriod[key]) retreatCountByPeriod[key] = 0;
      retreatCountByPeriod[key]++;
    });

    const retreatCountTrend = Object.entries(retreatCountByPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, active]) => ({ name, active }));

    // =====================================================
    // 4. Booking Rate Trend (bookings per period / capacity per period)
    // =====================================================
    const periodStats = {};
    
    // Aggregate capacity by period
    retreatsInRange.forEach(r => {
      if (!r.createdAt) return;
      const key = getDateKey(r.createdAt, granularity);
      if (!periodStats[key]) periodStats[key] = { capacity: 0, bookings: 0 };
      periodStats[key].capacity += (r.capacity || 10);
    });

    // Aggregate bookings by period
    bookingsInRange.forEach(b => {
      if (!b.createdAt) return;
      const key = getDateKey(b.createdAt, granularity);
      if (!periodStats[key]) periodStats[key] = { capacity: 0, bookings: 0 };
      periodStats[key].bookings++;
    });

    const bookingRateTrend = Object.entries(periodStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, stats]) => ({
        name,
        rate: stats.capacity > 0 ? Math.min(100, Math.round((stats.bookings / stats.capacity) * 100)) : 0,
      }));

    // =====================================================
    // 5. Revenue by Retreat Event (top 5)
    // =====================================================
    const revenueMap = {};
    bookingsInRange.forEach((b) => {
      if (!b.listingId) return;
      if (!revenueMap[b.listingId]) revenueMap[b.listingId] = { revenue: 0, bookings: 0 };
      revenueMap[b.listingId].revenue += b.amount;
      revenueMap[b.listingId].bookings++;
    });

    // Map listing IDs to retreat titles
    const retreatTitleMap = {};
    allRetreats.forEach((r) => { retreatTitleMap[r.id] = r.title; });

    const revenueByEvent = Object.entries(revenueMap)
      .map(([id, data]) => ({
        event: retreatTitleMap[id] || `Retreat ${id.substring(0, 6)}`,
        revenue: data.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // =====================================================
    // 6. Top Locations (top 5)
    // =====================================================
    const locationCount = {};
    retreatsInRange.forEach((r) => {
      const loc = r.location || 'Unknown';
      locationCount[loc] = (locationCount[loc] || 0) + 1;
    });

    const topLocations = Object.entries(locationCount)
      .map(([location, count]) => ({ location, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // =====================================================
    // 7. Average Price Trend
    // =====================================================
    const priceByPeriod = {};
    retreatsInRange.forEach((r) => {
      if (!r.createdAt || !r.price) return;
      const key = getDateKey(r.createdAt, granularity);
      if (!priceByPeriod[key]) priceByPeriod[key] = { total: 0, count: 0 };
      priceByPeriod[key].total += r.price;
      priceByPeriod[key].count++;
    });

    const avgPriceTrend = Object.entries(priceByPeriod)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        price: Math.round(data.total / data.count),
      }));

    // =====================================================
    // 8. Duration Breakdown (Pie chart)
    // =====================================================
    let short = 0, medium = 0, long = 0;
    retreatsInRange.forEach((r) => {
      if (r.durationDays <= 3) short++;
      else if (r.durationDays <= 7) medium++;
      else long++;
    });

    const durationBreakdown = [
      { name: '1-3 Days', value: short, color: '#4318FF' },
      { name: '4-7 Days', value: medium, color: '#01A3B4' },
      { name: '7+ Days', value: long, color: '#7C3AED' },
    ];

    // =====================================================
    // 9. Performance Table (top retreats by revenue)
    // =====================================================
    const retreatPerformanceData = Object.entries(revenueMap)
      .map(([id, data]) => {
        const retreat = allRetreats.find((r) => r.id === id);
        const cap = retreat?.capacity || 10;
        return {
          event: retreatTitleMap[id] || `Retreat ${id.substring(0, 6)}`,
          revenue: data.revenue,
          rate: Math.min(100, Math.round((data.bookings / cap) * 100)),
          price: retreat?.price || 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // =====================================================
    // 10. Summary Cards
    // =====================================================
    const totalCapacity = retreatsInRange.reduce((sum, r) => sum + (r.capacity || 10), 0);
    const activeRetreatsCount = retreatsInRange.filter((r) => r.isActive).length;
    const totalRetreatRevenue = bookingsInRange.reduce((sum, b) => sum + b.amount, 0);
    const avgPrice = retreatsInRange.length > 0
      ? Math.round(retreatsInRange.reduce((sum, r) => sum + r.price, 0) / retreatsInRange.length)
      : 0;
    const overallBookingRate = totalCapacity > 0
      ? Math.round((bookingsInRange.length / totalCapacity) * 100)
      : 0;

    const summary = [
      {
        title: 'Active Retreats',
        value: String(activeRetreatsCount),
        description: `${retreatsInRange.length} total in period`,
      },
      {
        title: 'Booking Rate',
        value: `${Math.min(100, overallBookingRate)}%`,
        description: 'Platform wide capacity',
      },
      {
        title: 'Total Revenue (Retreats)',
        value: `$${totalRetreatRevenue.toLocaleString()}`,
        description: 'Current period',
      },
      {
        title: 'Avg. Price',
        value: `$${avgPrice.toLocaleString()}`,
        description: 'Per person average',
      },
    ];

    return res.status(200).json({
      success: true,
      data: {
        summary,
        retreatCountTrend,
        bookingRateTrend,
        revenueByEvent,
        topLocations,
        avgPriceTrend,
        durationBreakdown,
        retreatPerformanceData,
      },
    });
  } catch (error) {
    console.error('Error fetching retreat report data:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch retreat report data',
    });
  }
};

/**
 * Get financial report data including revenue breakdown, trends, fee impact, rankings, and audit logs
 */
const getFinancialReportData = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const { startDate, endDate, granularity = 'Monthly', range = 'This Month' } = req.query;

    // Calculate date window as ISO strings
    let startIso, endIso;
    const now = new Date();

    if (startDate && endDate) {
      startIso = new Date(startDate).toISOString();
      endIso = new Date(endDate).toISOString();
    } else {
      endIso = now.toISOString();
      if (range === 'Today') {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Week') {
        const start = new Date(); start.setDate(now.getDate() - 56); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Month') {
        startIso = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();
      } else {
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    console.log(`[FinancialReport] Range: ${range}, Granularity: ${granularity}, Window: ${startIso} -> ${endIso}`);

    // =====================================================
    // 1. Fetch all bookings
    // =====================================================
    const bookingsSnap = await getDocs(collection(db, 'bookings'));
    const allBookings = bookingsSnap.docs.map((d) => {
      const data = d.data();
      const createdAt = toIsoOrNull(data.created_at || data.createdAt) || null;
      const amount = Number(data.amount || data.totalAmount || data.price || 0);
      const isRetreat = (
        (typeof data.format === 'string' && data.format.toLowerCase().includes('retreat')) ||
        (typeof data.modality === 'string' && data.modality.toLowerCase().includes('retreat')) ||
        (typeof data.listingTitle === 'string' && data.listingTitle.toLowerCase().includes('retreat')) ||
        (typeof data.title === 'string' && data.title.toLowerCase().includes('retreat'))
      );
      const status = typeof data.status === 'string' ? data.status : (data.status?.state || 'unknown');
      const isValid = status !== 'failed' && status !== 'cancelled';

      return {
        id: d.id,
        bookingId: 'BK-' + d.id.substring(0, 4).toUpperCase(),
        createdAt,
        amount,
        isRetreat,
        isValid,
        healerName: data.healerName || data.healer_name || 'Unknown',
        healerId: data.healerId || data.healer_id || null,
        seekerName: data.seekerName || data.seeker_name || 'Unknown',
        listingTitle: data.listingTitle || data.listing_title || data.title || 'N/A',
        paymentIntentId: data.paymentIntentId || data.payment_intent_id || 'N/A',
        paymentStatus: data.paymentStatus || data.payment_status || status,
      };
    });

    // Bookings within range (valid payments only)
    const bookingsInRange = allBookings.filter(
      (b) => b.createdAt && b.createdAt >= startIso && b.createdAt <= endIso && b.isValid
    );

    console.log(`[FinancialReport] Total bookings: ${allBookings.length}, In range (valid): ${bookingsInRange.length}`);

    // =====================================================
    // 2. Fetch premium healers
    // =====================================================
    const profilesSnap = await getDocs(collection(db, 'profiles'));
    const premiumHealers = profilesSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.displayName || data.name || 'Unknown',
          isPremium: data.subscription_type === 'premium' || !!data.isPremium || !!data.is_premium,
          activatedAt: toIsoOrNull(data.premium_activated_at || data.premiumActivatedAt) || null,
          stripeSessionId: data.stripe_session_id || data.stripeSessionId || 'N/A',
        };
      })
      .filter((p) => p.isPremium);

    const PREMIUM_PRICE = 120;

    // Premium activations in range
    const premiumInRange = premiumHealers.filter(
      (p) => p.activatedAt && p.activatedAt >= startIso && p.activatedAt <= endIso
    );

    // =====================================================
    // 3. Commission Breakdown (using commissionCalculator pattern)
    // =====================================================
    const HEALER_COMMISSION_PCT = 0.20;
    const SEEKER_FEE_PCT = 0.10;
    const STRIPE_FEE_PCT = 0.029;
    const STRIPE_FEE_FIXED = 0.30;

    const calcBreakdown = (amount) => {
      const healerCommission = Math.round(amount * HEALER_COMMISSION_PCT * 100) / 100;
      const seekerFee = Math.round(amount * SEEKER_FEE_PCT * 100) / 100;
      const stripeFee = Math.round(((amount + seekerFee) * STRIPE_FEE_PCT + STRIPE_FEE_FIXED) * 100) / 100;
      const platformRevenue = healerCommission + seekerFee;
      const netRevenue = platformRevenue - stripeFee;
      return { healerCommission, seekerFee, stripeFee, platformRevenue, netRevenue, grossAmount: amount + seekerFee };
    };

    // =====================================================
    // 4. Revenue by Source (Pie Chart)
    // =====================================================
    let sessionRevenue = 0;
    let retreatRevenue = 0;
    const subscriptionRevenue = premiumInRange.length * PREMIUM_PRICE;

    bookingsInRange.forEach((b) => {
      if (b.isRetreat) {
        retreatRevenue += b.amount;
      } else {
        sessionRevenue += b.amount;
      }
    });

    const revenueBySource = [
      { name: 'Sessions', value: Math.round(sessionRevenue), color: '#4318FF' },
      { name: 'Retreats', value: Math.round(retreatRevenue), color: '#6AD2FF' },
      { name: 'Subscriptions', value: Math.round(subscriptionRevenue), color: '#8A99AF' },
    ];

    // =====================================================
    // 5. Revenue Trend (Area Chart - grouped by granularity)
    // =====================================================
    const trendMap = {};

    bookingsInRange.forEach((b) => {
      if (!b.createdAt) return;
      const key = getDateKey(b.createdAt, granularity);
      if (!trendMap[key]) trendMap[key] = { sessions: 0, retreats: 0, subs: 0 };
      if (b.isRetreat) {
        trendMap[key].retreats += b.amount;
      } else {
        trendMap[key].sessions += b.amount;
      }
    });

    // Add subscription revenue to the period it was activated
    premiumInRange.forEach((p) => {
      if (!p.activatedAt) return;
      const key = getDateKey(p.activatedAt, granularity);
      if (!trendMap[key]) trendMap[key] = { sessions: 0, retreats: 0, subs: 0 };
      trendMap[key].subs += PREMIUM_PRICE;
    });

    const revenueTrend = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        name: month,
        sessions: Math.round(data.sessions),
        retreats: Math.round(data.retreats),
        subs: Math.round(data.subs),
      }));

    // =====================================================
    // 6. Monthly Revenue Comparison (Current vs Prior)
    // =====================================================
    const currentTotal = bookingsInRange.reduce((s, b) => s + b.amount, 0) + subscriptionRevenue;

    // Calculate prior period (same duration before startIso)
    const rangeDurationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
    const priorStartIso = new Date(new Date(startIso).getTime() - rangeDurationMs).toISOString();
    const priorEndIso = startIso;

    const priorBookings = allBookings.filter(
      (b) => b.createdAt && b.createdAt >= priorStartIso && b.createdAt < priorEndIso && b.isValid
    );
    const priorPremium = premiumHealers.filter(
      (p) => p.activatedAt && p.activatedAt >= priorStartIso && p.activatedAt < priorEndIso
    );
    const priorTotal = priorBookings.reduce((s, b) => s + b.amount, 0) + (priorPremium.length * PREMIUM_PRICE);

    const monthlyComparison = [
      { month: 'Current', revenue: Math.round(currentTotal), prior: Math.round(priorTotal) },
    ];

    // =====================================================
    // 7. Stripe Fee Impact (Line Chart - grouped by granularity)
    // =====================================================
    const feeMap = {};

    bookingsInRange.forEach((b) => {
      if (!b.createdAt) return;
      const key = getDateKey(b.createdAt, granularity);
      const bd = calcBreakdown(b.amount);
      if (!feeMap[key]) feeMap[key] = { gross: 0, fees: 0 };
      feeMap[key].gross += bd.grossAmount;
      feeMap[key].fees += bd.stripeFee;
    });

    const stripeFeeImpact = Object.entries(feeMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        gross: Math.round(data.gross),
        fees: Math.round(data.fees * 100) / 100,
      }));

    // =====================================================
    // 8. Top 10 Healers by Revenue
    // =====================================================
    const healerRevenueMap = {};
    bookingsInRange.forEach((b) => {
      const key = b.healerName || 'Unknown';
      if (!healerRevenueMap[key]) healerRevenueMap[key] = 0;
      healerRevenueMap[key] += b.amount;
    });

    const topHealers = Object.entries(healerRevenueMap)
      .map(([name, revenue]) => ({ name, revenue: Math.round(revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // =====================================================
    // 9. Top 10 Retreat Events by Revenue
    // =====================================================
    const retreatRevenueMap = {};
    bookingsInRange.filter((b) => b.isRetreat).forEach((b) => {
      const key = b.listingTitle || 'Unknown Retreat';
      if (!retreatRevenueMap[key]) retreatRevenueMap[key] = 0;
      retreatRevenueMap[key] += b.amount;
    });

    const topRetreats = Object.entries(retreatRevenueMap)
      .map(([name, revenue]) => ({ name, revenue: Math.round(revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // =====================================================
    // 10. Booking Audit Ledger (table data)
    // =====================================================
    const bookingAudit = bookingsInRange
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 50)
      .map((b) => {
        const bd = calcBreakdown(b.amount);
        return {
          date: b.createdAt ? b.createdAt.split('T')[0] : 'N/A',
          bookingId: b.bookingId,
          listing: b.listingTitle,
          healer: b.healerName,
          seeker: b.seekerName,
          grossAmount: bd.grossAmount,
          healerCommission: bd.healerCommission,
          seekerFee: bd.seekerFee,
          processingFee: bd.stripeFee,
          netRevenue: bd.netRevenue,
          stripePi: b.paymentIntentId,
        };
      });

    // =====================================================
    // 11. Premium Activation Log (table data)
    // =====================================================
    const premiumLog = premiumInRange.map((p) => ({
      healer: p.name,
      activationDate: p.activatedAt ? p.activatedAt.split('T')[0] : 'N/A',
      amount: PREMIUM_PRICE,
      stripeSessionId: p.stripeSessionId,
    }));

    // =====================================================
    // 12. Summary Cards
    // =====================================================
    const totalPlatformRevenue = bookingsInRange.reduce((s, b) => {
      const bd = calcBreakdown(b.amount);
      return s + bd.platformRevenue;
    }, 0) + subscriptionRevenue;

    let growthPctValue = 0;
    if (priorTotal > 0) {
      growthPctValue = ((currentTotal - priorTotal) / priorTotal) * 100;
    } else if (currentTotal > 0) {
      growthPctValue = 100;
    }
    const growthPct = growthPctValue.toFixed(1);

    const avgStripeFee = bookingsInRange.length > 0
      ? (bookingsInRange.reduce((s, b) => s + calcBreakdown(b.amount).stripeFee, 0) / bookingsInRange.length).toFixed(2)
      : '0.00';

    const summary = [
      {
        title: 'Total Platform Revenue',
        value: `$${Math.round(totalPlatformRevenue).toLocaleString()}`,
        description: `${bookingsInRange.length} bookings + ${premiumInRange.length} subscriptions`,
      },
      {
        title: 'Revenue Growth',
        value: `${growthPct}%`,
        description: 'vs. prior period',
      },
      {
        title: 'Gross Booking Volume',
        value: `$${Math.round(currentTotal).toLocaleString()}`,
        description: 'All sources combined',
      },
      {
        title: 'Avg. Stripe Fee',
        value: `$${avgStripeFee}`,
        description: 'Per transaction average',
      },
    ];

    return res.status(200).json({
      success: true,
      data: {
        summary,
        revenueBySource,
        revenueTrend,
        monthlyComparison,
        stripeFeeImpact,
        topHealers,
        topRetreats,
        bookingAudit,
        premiumLog,
      },
    });
  } catch (error) {
    console.error('Error fetching financial report data:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch financial report data',
    });
  }
};

/**
 * Get platform overview data (combined metrics)
 */
const getPlatformOverviewData = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const { startDate, endDate, granularity = 'Weekly', range = 'This Month' } = req.query;

    let startIso, endIso;
    const now = new Date();

    if (startDate && endDate && startDate !== "" && endDate !== "") {
      try {
        startIso = new Date(startDate).toISOString();
        endIso = new Date(endDate).toISOString();
      } catch (e) {
        // Fallback to default range if dates are invalid
        endIso = now.toISOString();
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    } else {
      endIso = now.toISOString();
      if (range === 'Today') {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Week') {
        const start = new Date(); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Month') {
        startIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // Reuse the same logic from other reports but combined
    // 1. Fetch data
    const [profilesSnap, bookingsSnap, premiumSnap] = await Promise.all([
      getDocs(collection(db, 'profiles')),
      getDocs(collection(db, 'bookings')),
      getDocs(collection(db, 'app_users')), // Assuming premium status is also tracked here or in profiles
    ]);

    const allProfiles = profilesSnap.docs.map(d => ({
      role: d.data().role,
      createdAt: toIsoOrNull(d.data().created_at || d.data().createdAt)
    }));

    const allBookings = bookingsSnap.docs.map(d => {
      const data = d.data();
      const rawStatus = data.status || 'unknown';
      const statusStr = typeof rawStatus === 'string' 
        ? rawStatus 
        : (rawStatus?.state || rawStatus?.status || String(rawStatus));
        
      return {
        amount: Number(data.amount || 0),
        createdAt: toIsoOrNull(data.created_at || data.createdAt),
        isRetreat: String(data.format || data.listingTitle || '').toLowerCase().includes('retreat'),
        isValid: !['cancelled', 'failed', 'refunded'].includes(statusStr.toLowerCase())
      };
    });

    const premiumInRange = premiumSnap.docs.filter(d => {
      const p = d.data();
      const activatedAt = toIsoOrNull(p.activatedAt || p.premium_activated_at);
      return p.isPremium && activatedAt && activatedAt >= startIso && activatedAt <= endIso;
    });

    // 2. Aggregate User Growth
    const userGrowthMap = {};
    allProfiles.forEach(p => {
      if (!p.createdAt || p.createdAt < startIso || p.createdAt > endIso) return;
      const key = getDateKey(p.createdAt, granularity);
      if (!userGrowthMap[key]) userGrowthMap[key] = { healers: 0, seekers: 0 };
      if (p.role === 'healer') userGrowthMap[key].healers++;
      else userGrowthMap[key].seekers++;
    });

    const userGrowth = Object.entries(userGrowthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({ name, ...data }));

    // 3. Aggregate Booking Volume & Revenue
    const volumeMap = {};
    const revenueMap = {};
    const PREMIUM_PRICE = 150;

    allBookings.forEach(b => {
      if (!b.createdAt || b.createdAt < startIso || b.createdAt > endIso || !b.isValid) return;
      const key = getDateKey(b.createdAt, granularity);
      
      if (!volumeMap[key]) volumeMap[key] = { sessions: 0, retreats: 0 };
      if (b.isRetreat) volumeMap[key].retreats++;
      else volumeMap[key].sessions++;

      if (!revenueMap[key]) revenueMap[key] = { commission: 0, fees: 0, premium: 0 };
      const comm = b.amount * 0.10; // 10% commission
      const fee = b.amount * 0.05;  // 5% seeker fee
      revenueMap[key].commission += comm;
      revenueMap[key].fees += fee;
    });

    // Add premium revenue to map
    premiumInRange.forEach(p => {
      const data = p.data();
      const activatedAt = toIsoOrNull(data.activatedAt || data.premium_activated_at);
      const key = getDateKey(activatedAt, granularity);
      if (!revenueMap[key]) revenueMap[key] = { commission: 0, fees: 0, premium: 0 };
      revenueMap[key].premium += PREMIUM_PRICE;
    });

    const bookingVolume = Object.entries(volumeMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({ name, ...data }));

    const revenue = Object.entries(revenueMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        commission: Math.round(data.commission),
        fees: Math.round(data.fees),
        premium: Math.round(data.premium)
      }));

    // 4. Summary Metrics
    const totalNewHealers = allProfiles.filter(p => p.role === 'healer' && p.createdAt >= startIso && p.createdAt <= endIso).length;
    const totalNewSeekers = allProfiles.filter(p => p.role === 'seeker' && p.createdAt >= startIso && p.createdAt <= endIso).length;
    const totalBookingsInRange = allBookings.filter(b => b.isValid && b.createdAt >= startIso && b.createdAt <= endIso);
    const totalSessions = totalBookingsInRange.filter(b => !b.isRetreat).length;
    const totalRetreats = totalBookingsInRange.filter(b => b.isRetreat).length;
    
    const grossVolume = totalBookingsInRange.reduce((s, b) => s + b.amount, 0);
    const totalPlatformRevenue = (grossVolume * 0.15) + (premiumInRange.length * PREMIUM_PRICE);

    // Mock disputes for now until collection exists
    const totalDisputes = Math.round(totalBookingsInRange.length * 0.005);
    const resolvedDisputes = Math.max(0, totalDisputes - 1);

    const summary = [
      { title: "New Healers", value: totalNewHealers.toLocaleString(), description: "Registered this period" },
      { title: "New Seekers", value: totalNewSeekers.toLocaleString(), description: "Registered this period" },
      { title: "Total Bookings", value: totalBookingsInRange.length.toLocaleString(), description: `${totalSessions} sessions · ${totalRetreats} retreats` },
      { title: "Gross Volume", value: `$${Math.round(grossVolume).toLocaleString()}`, description: "Total GBV this period" },
      { title: "Platform Revenue", value: `$${Math.round(totalPlatformRevenue).toLocaleString()}`, description: "Comm. + Fees + Subs" },
      { title: "Platform Disputes", value: `${totalDisputes} / ${resolvedDisputes}`, description: "Opened / Resolved" },
      { title: "Premium Upgrades", value: premiumInRange.length.toString(), description: "New subscribers" }
    ];

    // 5. Dynamic Health Score Calculation
    let healthScore = 100;
    if (totalBookingsInRange.length > 0) {
      // Every dispute is a significant hit to health. 
      // 1% dispute rate = 10 point drop.
      const disputeRate = (totalDisputes / totalBookingsInRange.length) * 100;
      healthScore = Math.max(0, Math.round(100 - (disputeRate * 10)));
    }

    return res.status(200).json({
      success: true,
      data: {
        summary,
        userGrowth,
        bookingVolume,
        revenue,
        healthScore,
      }
    });
  } catch (error) {
    console.error('Error fetching platform overview data:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get dispute report data including trends, severity, outcomes, and repeat offenders
 */
const getDisputeReportData = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const { startDate, endDate, granularity = 'Weekly', range = 'This Month' } = req.query;

    // Calculate date window as ISO strings
    let startIso, endIso;
    const now = new Date();

    if (startDate && endDate && startDate !== "" && endDate !== "") {
      try {
        startIso = new Date(startDate).toISOString();
        endIso = new Date(endDate).toISOString();
      } catch (e) {
        // Fallback to default range if dates are invalid
        endIso = now.toISOString();
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    } else {
      endIso = now.toISOString();
      if (range === 'Today') {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Week') {
        const start = new Date(); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
        startIso = start.toISOString();
      } else if (range === 'This Month') {
        startIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        startIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // 1. Fetch Data
    const [disputesSnap, bookingsSnap] = await Promise.all([
      getDocs(collection(db, 'disputes')),
      getDocs(collection(db, 'bookings'))
    ]);

    const allDisputes = disputesSnap.docs.map(d => {
      const data = d.data();
      // Check multiple possible date fields
      const createdAt = toIsoOrNull(data.submittedAt || data.createdAt || data.created_at || data.audit?.createdAt);
      
      return {
        id: d.id,
        createdAt,
        type: String(data.type || 'Other'),
        severity: String(data.severity || 'normal').toLowerCase(),
        outcome: String(data.outcome || data.decision || 'pending').toLowerCase(),
        healerId: data.healerId || data.practitionerId,
        healerName: data.healerName || data.practitionerName || 'Unknown Healer',
        modality: String(data.modality || data.format || 'Unknown').split(' ').pop() || 'Other'
      };
    });

    const allBookings = bookingsSnap.docs.map(d => {
      const data = d.data();
      const rawStatus = data.status || 'unknown';
      const statusStr = typeof rawStatus === 'string'
        ? rawStatus
        : (rawStatus?.state || rawStatus?.status || String(rawStatus));

      return {
        id: d.id,
        createdAt: toIsoOrNull(data.createdAt || data.created_at),
        isValid: !['cancelled', 'failed', 'refunded'].includes(statusStr.toLowerCase())
      };
    });

    // 2. Filter by range
    const disputesInRange = allDisputes.filter(d => d.createdAt && d.createdAt >= startIso && d.createdAt <= endIso);
    const bookingsInRange = allBookings.filter(b => b.createdAt && b.createdAt >= startIso && b.createdAt <= endIso && b.isValid);

    // 3. Dispute Rate Trend
    const trendMap = {};
    bookingsInRange.forEach(b => {
      const key = getDateKey(b.createdAt, granularity);
      if (!trendMap[key]) trendMap[key] = { bookings: 0, disputes: 0 };
      trendMap[key].bookings++;
    });
    disputesInRange.forEach(d => {
      const key = getDateKey(d.createdAt, granularity);
      if (!trendMap[key]) trendMap[key] = { bookings: 0, disputes: 0 };
      trendMap[key].disputes++;
    });

    const disputeRateTrend = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        rate: data.bookings > 0 ? Number(((data.disputes / data.bookings) * 100).toFixed(1)) : 0
      }));

    // 4. Disputes by Type
    const typeMap = {};
    disputesInRange.forEach(d => {
      typeMap[d.type] = (typeMap[d.type] || 0) + 1;
    });
    const disputesByType = Object.entries(typeMap).map(([name, value]) => ({ name, value }));

    // 5. Disputes by Severity
    const severityMap = {};
    disputesInRange.forEach(d => {
      const key = getDateKey(d.createdAt, granularity);
      if (!severityMap[key]) severityMap[key] = { normal: 0, safety: 0 };
      if (d.severity === 'safety') severityMap[key].safety++;
      else severityMap[key].normal++;
    });
    const disputesBySeverity = Object.entries(severityMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({ name, ...data }));

    // 6. Outcome Breakdown
    const outcomeMap = {};
    disputesInRange.forEach(d => {
      const key = getDateKey(d.createdAt, granularity);
      if (!outcomeMap[key]) outcomeMap[key] = { refund: 0, partial: 0, credit: 0, deny: 0 };
      if (d.outcome === 'refund') outcomeMap[key].refund++;
      else if (d.outcome === 'partial') outcomeMap[key].partial++;
      else if (d.outcome === 'credit') outcomeMap[key].credit++;
      else if (d.outcome === 'deny' || d.outcome === 'rejected') outcomeMap[key].deny++;
    });
    const outcomeBreakdown = Object.entries(outcomeMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({ name, ...data }));

    // 7. Modality Dispute Rate
    const modalityMap = {};
    disputesInRange.forEach(d => {
      modalityMap[d.modality] = (modalityMap[d.modality] || 0) + 1;
    });
    const modalityDisputeRate = Object.entries(modalityMap)
      .map(([name, value]) => ({ name, value: Number(((value / disputesInRange.length) * 100).toFixed(1)) }))
      .sort((a, b) => b.value - a.value);

    // 8. Healer Repeat Disputes
    const healerMap = {};
    allDisputes.forEach(d => {
      if (!d.healerId) return;
      if (!healerMap[d.healerId]) healerMap[d.healerId] = { name: d.healerName, count: 0 };
      healerMap[d.healerId].count++;
    });
    const healerRepeatDisputes = Object.entries(healerMap)
      .map(([id, data]) => ({
        name: data.name,
        disputes: data.count,
        status: data.count >= 2 ? 'flagged' : 'good'
      }))
      .sort((a, b) => b.disputes - a.disputes);

    // Summary Metrics
    const totalDisputes = disputesInRange.length;
    const safetyDisputes = disputesInRange.filter(d => d.severity === 'safety').length;
    const resolvedDisputes = disputesInRange.filter(d => d.outcome !== 'pending').length;
    const avgResolutionHours = 24; // Mock for now

    const summaryData = [
      { title: "Total Disputes", value: totalDisputes.toString(), description: "Active in period" },
      { title: "Safety Incidents", value: safetyDisputes.toString(), description: "Requires immediate attention" },
      { title: "Resolution Rate", value: totalDisputes > 0 ? `${Math.round((resolvedDisputes / totalDisputes) * 100)}%` : "100%", description: "Disputes closed" },
      { title: "Avg. Resolve Time", value: `${avgResolutionHours}h`, description: "Platform average" }
    ];

    return res.status(200).json({
      success: true,
      data: {
        summaryData,
        disputeRateTrend,
        disputesByType,
        disputesBySeverity,
        resolutionTimeTrend: [], // Mock or add later
        outcomeBreakdown,
        modalityDisputeRate,
        healerRepeatDisputes
      }
    });
  } catch (error) {
    console.error('Error fetching dispute report data:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getUserReportData,
  getRetreatReportData,
  getFinancialReportData,
  getPlatformOverviewData,
  getDisputeReportData,
};
