const { collection, addDoc, doc, setDoc, getDoc, getDocs, deleteDoc, query, where, orderBy, limit } = require('firebase/firestore');
const { getDatabase } = require('../config/database');

const anonymizeIp = (ip) => {
  if (!ip) return '0.0.0.0';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return parts.join('.');
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length > 2) {
      return parts.slice(0, 3).join(':') + '::';
    }
  }
  return '0.0.0.0';
};

const parseUserAgent = (uaString = '') => {
  const ua = uaString.toLowerCase();
  let device = 'Desktop';
  if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) {
    device = 'Mobile';
  } else if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) {
    device = 'Tablet';
  }

  let browser = 'Other';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('safari/')) browser = 'Safari';
  else if (ua.includes('firefox/')) browser = 'Firefox';

  return { device, browser };
};

const getCanonicalDomainCategory = (domStr) => {
  if (!domStr) return 'website';
  const d = domStr.toLowerCase().trim();

  if (d.includes('admin') || d.includes(':5173') || d.includes(':3000')) {
    return 'admin';
  }
  if (d.startsWith('seeker') || d.includes('seekers.') || d.includes('seeker-app') || d.includes(':5174') || d.includes(':3001')) {
    return 'seekers';
  }
  if (d.startsWith('healer') || d.includes('healers.ultrahealers') || d.includes('healer-app') || d.includes(':5175') || d.includes(':3002')) {
    return 'healers';
  }
  return 'website';
};

const normalizeDomainName = (rawDom) => {
  const cat = getCanonicalDomainCategory(rawDom);
  if (cat === 'admin') return 'admin-console.ultrahealers.com';
  if (cat === 'seekers') return 'seekers.ultrahealers.com';
  if (cat === 'healers') return 'healers.ultrahealers.com';
  return 'ultrahealers.com';
};

const formatClickDescriptor = (raw) => {
  if (!raw) return 'Interactive Element';

  const legacyMap = {
    'Action Button': 'Primary Action Button',
    'Button Click': 'Interactive Control Button',
    'Icon / Action (Button)': 'Icon Action Button',
    'Link Click': 'Navigation Link',
    'Interactive Element': 'Interactive UI Element'
  };

  if (legacyMap[raw]) {
    return legacyMap[raw];
  }

  if (raw.startsWith('"') || raw.startsWith('#')) {
    return raw;
  }

  if (!raw.includes('.')) {
    return raw;
  }

  const match = raw.match(/^([a-z0-9]+)(?:\.[a-z0-9_-]+)*\s*(?:\("([^"]+)"\))?/i);
  if (match) {
    const tag = match[1] ? match[1].toLowerCase() : 'element';
    const text = match[2] ? match[2].trim() : '';
    const tagLabel = tag === 'a' ? 'Link' : tag === 'button' ? 'Button' : tag;

    if (text && !/^\d+$/.test(text)) {
      return `"${text}" (${tagLabel})`;
    }

    if (raw.includes('refresh') || raw.includes('spin') || raw.includes('rotate')) {
      return `"Refresh Data" (${tagLabel})`;
    }
    if (raw.includes('export') || raw.includes('download')) {
      return `"Export File" (${tagLabel})`;
    }
    if (raw.includes('filter') || raw.includes('select')) {
      return `"Filter Control" (${tagLabel})`;
    }
    if (raw.includes('search')) {
      return `"Search Bar" (${tagLabel})`;
    }
    if (raw.includes('rounded-xl') || raw.includes('rounded-full') || raw.includes('p-2')) {
      return `Icon Action (${tagLabel})`;
    }
    return `${tagLabel} Action`;
  }
  return raw;
};

const collectAnalyticsEvent = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(200).json({ success: false, error: 'Database uninitialized' });
    }

    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        payload = {};
      }
    }

    const events = Array.isArray(payload) ? payload : [payload];
    const clientIp = anonymizeIp(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
    const userAgentHeader = req.headers['user-agent'] || '';
    const { device, browser } = parseUserAgent(userAgentHeader);

    for (const evt of events) {
      if (!evt || !evt.sessionId) continue;

      const {
        sessionId,
        domain = 'ultrahealers.com',
        path = '/',
        referrer = 'direct',
        utmSource = '',
        utmMedium = '',
        utmCampaign = '',
        userId = null,
        role = null,
        eventType = 'pageview',
        timeOnPage = 0,
        targetElement = null,
        timestamp = new Date().toISOString()
      } = evt;

      const nowIso = new Date().toISOString();
      const sessionRef = doc(db, 'analytics_sessions', sessionId);

      try {
        const sessionSnap = await getDoc(sessionRef);

        if (!sessionSnap.exists()) {
          await setDoc(sessionRef, {
            sessionId,
            domain,
            firstPath: path,
            lastPath: path,
            referrer: referrer || 'direct',
            utmSource,
            utmMedium,
            utmCampaign,
            userId,
            role,
            device,
            browser,
            ipAnonymized: clientIp,
            createdAt: timestamp || nowIso,
            updatedAt: nowIso,
            pageviewCount: eventType === 'pageview' ? 1 : 0,
            durationSeconds: Math.min(Math.max(0, Number(timeOnPage) || 0), 1800),
            isBounce: true
          });
        } else {
          const existing = sessionSnap.data();
          const newPvCount = (existing.pageviewCount || 0) + (eventType === 'pageview' ? 1 : 0);
          const safeTimeOnPage = Math.min(Math.max(0, Number(timeOnPage) || 0), 1800);
          const newDuration = Math.min(Math.max(existing.durationSeconds || 0, safeTimeOnPage), 1800);

          await setDoc(sessionRef, {
            ...existing,
            lastPath: path,
            userId: userId || existing.userId,
            role: role || existing.role,
            updatedAt: nowIso,
            pageviewCount: newPvCount,
            durationSeconds: newDuration,
            isBounce: newPvCount <= 1 && newDuration < 10
          }, { merge: true });
        }

        if (eventType === 'pageview') {
          await addDoc(collection(db, 'analytics_pageviews'), {
            sessionId,
            domain,
            path,
            referrer: referrer || 'direct',
            userId,
            role,
            timestamp: timestamp || nowIso,
            timeOnPageSeconds: Number(timeOnPage) || 0
          });
        } else if (
          eventType === 'click' ||
          eventType === 'time_on_page' ||
          eventType === 'exit' ||
          eventType === 'error' ||
          eventType === 'rage_click' ||
          eventType === 'web_vitals' ||
          eventType === 'conversion'
        ) {
          await addDoc(collection(db, 'analytics_events'), {
            sessionId,
            domain,
            path,
            eventType,
            targetElement: targetElement || evt.targetElement || null,
            vitals: evt.vitals || null,
            errorMessage: evt.errorMessage || null,
            source: evt.source || null,
            line: evt.line || null,
            col: evt.col || null,
            stack: evt.stack || null,
            goalName: evt.goalName || null,
            userId,
            role,
            timestamp: timestamp || nowIso,
            timeOnPageSeconds: Number(timeOnPage) || 0
          });
        }
      } catch (docErr) {
        console.warn('Analytics doc write warning:', docErr.message);
      }
    }

    return res.status(200).json({ success: true, count: events.length });
  } catch (error) {
    console.error('Analytics collector error:', error);
    return res.status(200).json({ success: false, error: error.message });
  }
};

const getAnalyticsStats = async (req, res) => {
  try {
    const db = getDatabase();
    const { range = '30d', subdomain = 'all' } = req.query;

    const now = new Date();
    let startDate = new Date(now);

    if (range === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (range === '30d') {
      startDate.setDate(now.getDate() - 30);
    } else if (range === '90d') {
      startDate.setDate(now.getDate() - 90);
    } else if (range === 'ytd') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else if (range === 'all') {
      startDate = new Date(2020, 0, 1);
    } else {
      startDate.setDate(now.getDate() - 30);
    }

    const rawSubdomains = typeof subdomain === 'string'
      ? subdomain.split(',').map(d => d.trim()).filter(Boolean)
      : Array.isArray(subdomain) ? subdomain : ['all'];

    const matchesSubdomain = (itemDomain) => {
      if (rawSubdomains.includes('all') || rawSubdomains.length === 0) return true;
      if (!itemDomain) return false;

      const itemCategory = getCanonicalDomainCategory(itemDomain);

      return rawSubdomains.some((target) => {
        const targetCategory = getCanonicalDomainCategory(target);
        return itemCategory === targetCategory;
      });
    };

    const startIso = startDate.toISOString();
    const durationMs = now.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - durationMs);
    const prevStartIso = prevStartDate.toISOString();
    const prevEndIso = startIso;

    let totalSessions = 0;
    let totalBounceSessions = 0;
    let totalDurationSeconds = 0;

    let prevSessions = 0;
    let prevBounceSessions = 0;
    let prevDurationSeconds = 0;

    const referrerMap = {};
    const subdomainMap = {};
    const utmMap = {};

    let totalPageviews = 0;
    let prevPageviews = 0;
    const pagePathMap = {};
    const pageTimeMap = {};

    const clickMap = {};
    const exitMap = {};

    // New metrics maps
    const errorMap = {};
    const rageClickMap = {};
    const conversionMap = {};
    let totalLcpMs = 0;
    let totalCls = 0;
    let totalFidMs = 0;
    let vitalsSampleCount = 0;

    const monthlyAcquisition = {};

    if (db) {
      // 1. Sessions
      try {
        const sessionsSnap = await getDocs(query(collection(db, 'analytics_sessions'), limit(1500)));
        sessionsSnap.docs.forEach((docSnap) => {
          const s = docSnap.data();
          if (!s.createdAt || s.createdAt < prevStartIso) return;
          if (!matchesSubdomain(s.domain)) return;

          if (s.createdAt >= startIso) {
            totalSessions += 1;
            if (s.isBounce) totalBounceSessions += 1;
            totalDurationSeconds += Number(s.durationSeconds || 0);

            const ref = s.referrer || 'Direct / None';
            referrerMap[ref] = (referrerMap[ref] || 0) + 1;

            const dom = normalizeDomainName(s.domain);
            subdomainMap[dom] = (subdomainMap[dom] || 0) + 1;

            if (s.utmSource) {
              const utmKey = `${s.utmSource} / ${s.utmMedium || 'none'}`;
              utmMap[utmKey] = (utmMap[utmKey] || 0) + 1;
            }
          } else if (s.createdAt < prevEndIso) {
            prevSessions += 1;
            if (s.isBounce) prevBounceSessions += 1;
            prevDurationSeconds += Number(s.durationSeconds || 0);
          }
        });
      } catch (err) {
        console.warn('Analytics sessions query warning:', err.message);
      }

      // 2. Pageviews
      try {
        const pageviewsSnap = await getDocs(query(collection(db, 'analytics_pageviews'), limit(2500)));
        pageviewsSnap.docs.forEach((docSnap) => {
          const p = docSnap.data();
          if (!p.timestamp || p.timestamp < prevStartIso) return;
          if (!matchesSubdomain(p.domain)) return;

          if (p.timestamp >= startIso) {
            totalPageviews += 1;
            const cleanPath = p.path || '/';
            const dom = p.domain || 'admin-console.ultrahealers.com';
            const key = `${dom}::${cleanPath}`;

            if (!pagePathMap[key]) {
              pagePathMap[key] = { path: cleanPath, domain: dom, views: 0 };
            }
            pagePathMap[key].views += 1;

            if (p.timeOnPageSeconds) {
              if (!pageTimeMap[key]) pageTimeMap[key] = { count: 0, totalSeconds: 0 };
              pageTimeMap[key].count += 1;
              pageTimeMap[key].totalSeconds += Number(p.timeOnPageSeconds);
            }
          } else if (p.timestamp < prevEndIso) {
            prevPageviews += 1;
          }
        });
      } catch (err) {
        console.warn('Analytics pageviews query warning:', err.message);
      }

      // 3. Events
      try {
        const eventsSnap = await getDocs(query(collection(db, 'analytics_events'), limit(2500)));
        eventsSnap.docs.forEach((docSnap) => {
          const e = docSnap.data();
          if (!e.timestamp || e.timestamp < startIso) return;
          if (!matchesSubdomain(e.domain)) return;

          const dom = e.domain || 'admin-console.ultrahealers.com';

          if (e.eventType === 'click' && e.targetElement) {
            const formatted = formatClickDescriptor(e.targetElement);
            const clickKey = `${dom}::${formatted}`;
            if (!clickMap[clickKey]) {
              clickMap[clickKey] = { element: formatted, domain: dom, count: 0 };
            }
            clickMap[clickKey].count += 1;
          }
          if (e.eventType === 'rage_click' && e.targetElement) {
            const formatted = formatClickDescriptor(e.targetElement);
            rageClickMap[formatted] = (rageClickMap[formatted] || 0) + 1;
          }
          if (e.eventType === 'error' && e.errorMessage) {
            const errKey = `${e.errorMessage} (${e.source || 'Script'})`;
            if (!errorMap[errKey]) {
              errorMap[errKey] = { message: e.errorMessage, source: e.source || 'Script', count: 0 };
            }
            errorMap[errKey].count += 1;
          }
          if (e.eventType === 'web_vitals' && e.vitals) {
            vitalsSampleCount += 1;
            if (e.vitals.lcp) totalLcpMs += Number(e.vitals.lcp);
            if (e.vitals.cls) totalCls += Number(e.vitals.cls);
            if (e.vitals.fid) totalFidMs += Number(e.vitals.fid);
          }
          if (e.eventType === 'conversion' && e.goalName) {
            conversionMap[e.goalName] = (conversionMap[e.goalName] || 0) + 1;
          }
          if (e.eventType === 'exit' && e.path) {
            const cleanExitPath = e.path || '/';
            const exitKey = `${dom}::${cleanExitPath}`;
            if (!exitMap[exitKey]) {
              exitMap[exitKey] = { path: cleanExitPath, domain: dom, count: 0 };
            }
            exitMap[exitKey].count += 1;
          }

          if (e.timeOnPageSeconds && Number(e.timeOnPageSeconds) > 0 && e.path) {
            const cleanPath = e.path || '/';
            const timeKey = `${dom}::${cleanPath}`;
            if (!pageTimeMap[timeKey]) pageTimeMap[timeKey] = { count: 0, totalSeconds: 0 };
            pageTimeMap[timeKey].count += 1;
            pageTimeMap[timeKey].totalSeconds += Number(e.timeOnPageSeconds);
          }
        });
      } catch (err) {
        console.warn('Analytics events query warning:', err.message);
      }

      // 4. User Acquisition Profiles
      try {
        const profilesSnap = await getDocs(collection(db, 'profiles'));
        profilesSnap.docs.forEach((docSnap) => {
          const p = docSnap.data();
          const rawDate = p.created_at || p.createdAt || p.joined_at;
          if (!rawDate) return;

          let dateObj = null;
          if (typeof rawDate === 'string') dateObj = new Date(rawDate);
          else if (typeof rawDate.toDate === 'function') dateObj = rawDate.toDate();
          else if (rawDate.seconds) dateObj = new Date(rawDate.seconds * 1000);

          if (!dateObj || isNaN(dateObj.getTime())) return;

          const year = dateObj.getFullYear();
          const monthStr = String(dateObj.getMonth() + 1).padStart(2, '0');
          const key = `${year}-${monthStr}`;

          if (!monthlyAcquisition[key]) {
            const monthLabel = dateObj.toLocaleString('en-US', { month: 'short', year: 'numeric' });
            monthlyAcquisition[key] = { monthKey: key, label: monthLabel, healers: 0, seekers: 0, total: 0 };
          }

          const role = String(p.role || '').toLowerCase();
          if (role === 'healer') {
            monthlyAcquisition[key].healers += 1;
            monthlyAcquisition[key].total += 1;
          } else if (role === 'seeker') {
            monthlyAcquisition[key].seekers += 1;
            monthlyAcquisition[key].total += 1;
          }
        });
      } catch (err) {
        console.warn('Analytics profiles query warning:', err.message);
      }
    }

    const monthlyAcquisitionList = Object.values(monthlyAcquisition)
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    const topReferrers = Object.entries(referrerMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topPages = Object.values(pagePathMap)
      .map((item) => {
        const timeData = pageTimeMap[`${item.domain}::${item.path}`];
        const avgTimeSeconds = timeData && timeData.count > 0 
          ? Math.round(timeData.totalSeconds / timeData.count) 
          : 0;
        return { path: item.path, domain: item.domain, views: item.views, avgTimeSeconds };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    const topClicks = Object.values(clickMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const rageClicks = Object.entries(rageClickMap)
      .map(([element, count]) => ({ element, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topErrors = Object.values(errorMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const conversions = Object.entries(conversionMap)
      .map(([goalName, count]) => ({ goalName, count }))
      .sort((a, b) => b.count - a.count);

    const topExits = Object.values(exitMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const subdomainBreakdown = Object.entries(subdomainMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const utmCampaigns = Object.entries(utmMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const avgDuration = totalSessions > 0 ? Math.round(totalDurationSeconds / totalSessions) : 0;
    const prevAvgDuration = prevSessions > 0 ? Math.round(prevDurationSeconds / prevSessions) : 0;

    const bounceRate = totalSessions > 0 ? Math.round((totalBounceSessions / totalSessions) * 100) : 0;
    const prevBounceRate = prevSessions > 0 ? Math.round((prevBounceSessions / prevSessions) * 100) : 0;

    const formatTrend = (curr, prev, isInverse = false) => {
      if (prev === 0) {
        if (curr === 0) return { label: '0.0% vs previous period', trend: 'neutral' };
        return { label: `+100% vs previous period`, trend: isInverse ? 'down' : 'up' };
      }
      const diff = ((curr - prev) / prev) * 100;
      const sign = diff > 0 ? '+' : '';
      const trend = diff > 0 ? (isInverse ? 'down' : 'up') : diff < 0 ? (isInverse ? 'up' : 'down') : 'neutral';
      return { label: `${sign}${diff.toFixed(1)}% vs previous period`, trend };
    };

    const pageviewsTrend = formatTrend(totalPageviews, prevPageviews);
    const sessionsTrend = formatTrend(totalSessions, prevSessions);
    const durationTrend = formatTrend(avgDuration, prevAvgDuration);
    const bounceRateTrend = formatTrend(bounceRate, prevBounceRate, true);

    const webVitals = {
      avgLcpMs: vitalsSampleCount > 0 ? Math.round(totalLcpMs / vitalsSampleCount) : 0,
      avgCls: vitalsSampleCount > 0 ? Number((totalCls / vitalsSampleCount).toFixed(3)) : 0,
      avgFidMs: vitalsSampleCount > 0 ? Math.round(totalFidMs / vitalsSampleCount) : 0,
      sampleCount: vitalsSampleCount
    };

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalPageviews,
          totalSessions,
          avgDurationSeconds: avgDuration,
          bounceRatePercent: bounceRate,
          trends: {
            pageviewsLabel: pageviewsTrend.label,
            pageviewsTrend: pageviewsTrend.trend,
            sessionsLabel: sessionsTrend.label,
            sessionsTrend: sessionsTrend.trend,
            durationLabel: durationTrend.label,
            durationTrend: durationTrend.trend,
            bounceRateLabel: bounceRateTrend.label,
            bounceRateTrend: bounceRateTrend.trend
          }
        },
        webVitals,
        topErrors,
        rageClicks,
        conversions,
        monthlyAcquisition: monthlyAcquisitionList,
        topReferrers,
        topPages,
        topClicks,
        topExits,
        subdomainBreakdown,
        utmCampaigns
      }
    });
  } catch (error) {
    console.error('Error fetching analytics stats:', error);
    return res.status(200).json({
      success: true,
      data: {
        summary: { totalPageviews: 0, totalSessions: 0, avgDurationSeconds: 0, bounceRatePercent: 0 },
        webVitals: { avgLcpMs: 0, avgCls: 0, avgFidMs: 0, sampleCount: 0 },
        topErrors: [],
        rageClicks: [],
        conversions: [],
        monthlyAcquisition: [],
        topReferrers: [],
        topPages: [],
        topClicks: [],
        topExits: [],
        subdomainBreakdown: [],
        utmCampaigns: []
      }
    });
  }
};

const resetAnalyticsTrackers = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(200).json({ success: false, error: 'Database uninitialized' });
    }

    const { target = 'all' } = req.body || {};
    let deletedCount = 0;

    const collectionsToDelete = [];

    if (target === 'all' || target === 'sessions') {
      collectionsToDelete.push({ colName: 'analytics_sessions' });
    }
    if (target === 'all' || target === 'pageviews') {
      collectionsToDelete.push({ colName: 'analytics_pageviews' });
    }
    if (target === 'all' || target === 'events') {
      collectionsToDelete.push({ colName: 'analytics_events' });
    } else if (['clicks', 'exits', 'conversions', 'vitals', 'errors', 'rage_clicks'].includes(target)) {
      const typeMap = {
        clicks: 'click',
        exits: 'exit',
        conversions: 'conversion',
        vitals: 'web_vitals',
        errors: 'error',
        rage_clicks: 'rage_click'
      };
      collectionsToDelete.push({ colName: 'analytics_events', eventType: typeMap[target] });
    }

    for (const item of collectionsToDelete) {
      try {
        let q;
        if (item.eventType) {
          q = query(collection(db, item.colName), where('eventType', '==', item.eventType), limit(500));
        } else {
          q = query(collection(db, item.colName), limit(500));
        }

        const snap = await getDocs(q);
        const deletePromises = snap.docs.map((docSnap) => deleteDoc(docSnap.ref));
        await Promise.all(deletePromises);
        deletedCount += snap.docs.length;
      } catch (err) {
        console.warn(`Analytics delete warning for ${item.colName}:`, err.message);
      }
    }

    return res.status(200).json({
      success: true,
      target,
      deletedCount,
      message: target === 'all' 
        ? 'All analytics tracker counts cleared successfully' 
        : `Tracker counts for '${target}' cleared successfully`
    });
  } catch (error) {
    console.error('Error resetting analytics trackers:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  collectAnalyticsEvent,
  getAnalyticsStats,
  resetAnalyticsTrackers
};
