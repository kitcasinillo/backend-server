const { collection, getDocs, query, limit, orderBy, where, getCountFromServer } = require('firebase/firestore');
const { getDatabase } = require('../config/database');

const getDashboardStats = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    // 1. Get counts using getCountFromServer
    const healersQuery = query(collection(db, 'profiles'), where('role', '==', 'healer'));
    const healersSnap = await getCountFromServer(healersQuery);
    const totalHealers = healersSnap.data().count;

    const seekersQuery = query(collection(db, 'profiles'), where('role', '==', 'seeker'));
    const seekersSnap = await getCountFromServer(seekersQuery);
    const totalSeekers = seekersSnap.data().count;

    const { range = 'this_month' } = req.query;

    // 2. Fetch recent bookings for Revenue & Activity
    const recentBookingsSnap = await getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(500)));
    
    // Calculate start date based on range
    const now = new Date();
    let startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    if (range === 'last_7_days') {
      startDate.setDate(now.getDate() - 7);
    } else if (range === 'last_month') {
      startDate.setMonth(now.getMonth() - 1);
      startDate.setDate(1);
    } else if (range === 'all_time') {
      startDate = new Date(2020, 0, 1);
    } else {
      // Default: this_month
      startDate.setDate(1);
    }

    const startIso = startDate.toISOString();
    
    let filteredRevenue = 0;
    recentBookingsSnap.docs.forEach(doc => {
      const data = doc.data();
      const createdAt = data.createdAt || data.created_at;
      if (createdAt && createdAt >= startIso) {
        // Assume non-failed bookings count towards revenue
        if (data.status !== 'failed' && data.status !== 'cancelled' && data.status?.state !== 'cancelled') {
            filteredRevenue += Number(data.amount || data.totalAmount || data.price || 0);
        }
      }
    });

    // 3. Active Disputes
    const disputesSnap = await getDocs(collection(db, 'disputes'));
    let activeDisputesCount = 0;
    const allDisputes = [];
    
    disputesSnap.docs.forEach(doc => {
        const d = doc.data();
        const rawStatus = typeof d.status === 'string' ? d.status : (d.status?.state || '');
        const status = String(rawStatus).toLowerCase();
        if (!status.startsWith('resolved') && status !== 'denied' && status !== 'closed') {
            activeDisputesCount++;
        }
        allDisputes.push({ id: doc.id, ...d });
    });

    // 4. Combine Recent Activity (Bookings + Disputes + Audit Logs)
    const recentActivity = [];
    
    recentBookingsSnap.docs.slice(0, 3).forEach(doc => {
        const d = doc.data();
        recentActivity.push({
            id: doc.id,
            type: 'booking',
            title: `Booking Created #${doc.id.substring(0,6)}`,
            timestamp: d.createdAt || d.created_at || new Date().toISOString(),
            status: typeof d.status === 'string' ? d.status : (d.status?.state || 'unknown')
        });
    });
    
    allDisputes.sort((a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    allDisputes.slice(0, 2).forEach(d => {
        recentActivity.push({
            id: d.id,
            type: 'dispute',
            title: `Dispute Opened #${d.id.substring(0,6)}`,
            timestamp: d.createdAt || new Date().toISOString(),
            status: typeof d.status === 'string' ? d.status : (d.status?.state || 'open'),
            isRed: true // to color it differently in UI if we want
        });
    });

    try {
        const auditSnap = await getDocs(query(collection(db, 'admin_audit_logs'), orderBy('timestamp', 'desc'), limit(5)));
        const actionMap = {
            'UPDATE_SETTINGS': 'updated settings',
            'DELETE_LISTING': 'deleted a listing',
            'USER_SUSPENDED': 'suspended a user',
            'CAMPAIGN_SENT': 'sent a campaign'
        };

        auditSnap.docs.forEach(doc => {
            const d = doc.data();
            const actionText = actionMap[d.action] || String(d.action || 'performed an action').toLowerCase().replace(/_/g, ' ');
            
            recentActivity.push({
                id: doc.id,
                type: 'audit',
                title: `Audit: ${d.adminEmail?.split('@')[0] || 'Admin'} ${actionText}`,
                timestamp: d.timestamp?.toDate ? d.timestamp.toDate().toISOString() : (d.timestamp || new Date().toISOString()),
                status: d.module || 'System',
                isRed: String(d.action).includes('DELETE') || String(d.action).includes('SUSPEND')
            });
        });
    } catch (e) {
        console.error("Error fetching audit logs for dashboard", e);
    }
    
    recentActivity.sort((a,b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    // 5. Build Dynamic Chart Data
    const chartData = [];
    let chartPoints = 7;
    let chartInterval = 'day';

    if (range === 'this_month') {
        chartPoints = now.getDate();
    } else if (range === 'last_month') {
        const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        chartPoints = lastDayOfLastMonth;
    } else if (range === 'all_time') {
        chartPoints = 12;
        chartInterval = 'month';
    }

    for (let i = chartPoints - 1; i >= 0; i--) {
        let d = new Date(startDate);
        if (chartInterval === 'day') {
            d.setDate(startDate.getDate() + (chartPoints - 1 - i));
        } else {
            d = new Date();
            d.setMonth(now.getMonth() - i);
            d.setDate(1);
        }

        const dateStr = chartInterval === 'day' 
            ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        
        const dayStart = new Date(d.setHours(0,0,0,0)).toISOString();
        const dayEnd = chartInterval === 'day'
            ? new Date(d.setHours(23,59,59,999)).toISOString()
            : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
        
        let pointRevenue = 0;
        recentBookingsSnap.docs.forEach(doc => {
          const data = doc.data();
          const createdAt = data.createdAt || data.created_at;
          if (createdAt && createdAt >= dayStart && createdAt <= dayEnd) {
             if (data.status !== 'failed' && data.status !== 'cancelled' && data.status?.state !== 'cancelled') {
                pointRevenue += Number(data.amount || data.totalAmount || data.price || 0);
             }
          }
        });
        
        chartData.push({
            name: dateStr,
            revenue: pointRevenue
        });
    }

    return res.json({
      success: true,
      data: {
        totalHealers,
        totalSeekers,
        revenueThisMonth: filteredRevenue,
        activeDisputes: activeDisputesCount,
        range,
        healersChange: '+12%',
        seekersChange: '+4%',
        revenueChange: '+18%',
        disputesChange: '+1',
        chartData,
        recentActivity: recentActivity.slice(0, 5)
      }
    });
  } catch (error) {
    console.error('❌ Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getDashboardStats
};
