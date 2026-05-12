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
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return null;
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
    
    // Calculate date window as ISO strings (proven pattern from dashboardController)
    let startIso, endIso;
    const now = new Date();

    if (startDate && endDate) {
      startIso = new Date(startDate).toISOString();
      endIso = new Date(endDate).toISOString();
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
        let periodKey = '';
        if (granularity === 'Weekly') {
          const d = new Date(bookingDate);
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          d.setDate(diff);
          periodKey = d.toISOString().split('T')[0];
        } else if (granularity === 'Monthly') {
          periodKey = bookingDate.substring(0, 7);
        } else {
          periodKey = bookingDate.split('T')[0];
        }

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

    // =====================================================
    // 3. Active Retreat Count Trend (grouped by granularity)
    // =====================================================
    const getDateKey = (isoStr, gran) => {
      if (gran === 'Weekly') {
        const d = new Date(isoStr);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        return d.toISOString().split('T')[0];
      } else if (gran === 'Monthly') {
        return isoStr.substring(0, 7);
      }
      return isoStr.split('T')[0];
    };

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

    // Helper: get date grouping key
    const getDateKey = (isoStr, gran) => {
      if (gran === 'Weekly') {
        const d = new Date(isoStr);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        return d.toISOString().split('T')[0];
      } else if (gran === 'Monthly') {
        return isoStr.substring(0, 7);
      }
      return isoStr.split('T')[0];
    };

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

module.exports = {
  getUserReportData,
  getRetreatReportData,
  getFinancialReportData,
};
