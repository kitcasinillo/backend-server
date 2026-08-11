const { collection, addDoc, doc, setDoc, getDoc, getDocs, query, where, orderBy, limit } = require('firebase/firestore');
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

const formatClickDescriptor = (raw) => {
  if (!raw) return 'Interactive Element';
  if (!raw.includes('.')) return raw;

  const match = raw.match(/^([a-z0-9]+)(?:\.[a-z0-9_-]+)*\s*(?:\("([^"]+)"\))?/i);
  if (match) {
    const tag = match[1] ? match[1].toLowerCase() : 'element';
    const text = match[2] ? match[2].trim() : '';
    const tagLabel = tag === 'a' ? 'Link' : tag === 'button' ? 'Button' : tag;

    if (text && !/^\d+$/.test(text)) {
      return `"${text}" (${tagLabel})`;
    }
    if (raw.includes('rounded-xl') || raw.includes('rounded-full') || raw.includes('p-2')) {
      return `Icon / Action (${tagLabel})`;
    }
    return `${tagLabel} Click`;
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
            durationSeconds: Number(timeOnPage) || 0,
            isBounce: true
          });
        } else {
          const existing = sessionSnap.data();
          const newPvCount = (existing.pageviewCount || 0) + (eventType === 'pageview' ? 1 : 0);
          const newDuration = Math.max(existing.durationSeconds || 0, Number(timeOnPage) || 0);

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

    const startIso = startDate.toISOString();

    let totalSessions = 0;
    let totalBounceSessions = 0;
    let totalDurationSeconds = 0;
    const referrerMap = {};
    const subdomainMap = {};
    const utmMap = {};

    let totalPageviews = 0;
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
        const sessionsSnap = await getDocs(query(collection(db, 'analytics_sessions'), limit(1000)));
        sessionsSnap.docs.forEach((docSnap) => {
          const s = docSnap.data();
          if (!s.createdAt || s.createdAt < startIso) return;
          if (subdomain !== 'all' && s.domain !== subdomain && !s.domain?.includes(subdomain)) return;

          totalSessions += 1;
          if (s.isBounce) totalBounceSessions += 1;
          totalDurationSeconds += Number(s.durationSeconds || 0);

          const ref = s.referrer || 'Direct / None';
          referrerMap[ref] = (referrerMap[ref] || 0) + 1;

          const dom = s.domain || 'ultrahealers.com';
          subdomainMap[dom] = (subdomainMap[dom] || 0) + 1;

          if (s.utmSource) {
            const utmKey = `${s.utmSource} / ${s.utmMedium || 'none'}`;
            utmMap[utmKey] = (utmMap[utmKey] || 0) + 1;
          }
        });
      } catch (err) {
        console.warn('Analytics sessions query warning:', err.message);
      }

      // 2. Pageviews
      try {
        const pageviewsSnap = await getDocs(query(collection(db, 'analytics_pageviews'), limit(2000)));
        pageviewsSnap.docs.forEach((docSnap) => {
          const p = docSnap.data();
          if (!p.timestamp || p.timestamp < startIso) return;
          if (subdomain !== 'all' && p.domain !== subdomain && !p.domain?.includes(subdomain)) return;

          totalPageviews += 1;
          const cleanPath = p.path || '/';
          const fullPath = p.domain && p.domain !== 'localhost' && !p.domain.includes('127.0.0.1')
            ? `${p.domain}${cleanPath}`
            : cleanPath;
          pagePathMap[fullPath] = (pagePathMap[fullPath] || 0) + 1;

          if (p.timeOnPageSeconds) {
            if (!pageTimeMap[fullPath]) pageTimeMap[fullPath] = { count: 0, totalSeconds: 0 };
            pageTimeMap[fullPath].count += 1;
            pageTimeMap[fullPath].totalSeconds += Number(p.timeOnPageSeconds);
          }
        });
      } catch (err) {
        console.warn('Analytics pageviews query warning:', err.message);
      }

      // 3. Events
      try {
        const eventsSnap = await getDocs(query(collection(db, 'analytics_events'), limit(2000)));
        eventsSnap.docs.forEach((docSnap) => {
          const e = docSnap.data();
          if (!e.timestamp || e.timestamp < startIso) return;
          if (subdomain !== 'all' && e.domain !== subdomain && !e.domain?.includes(subdomain)) return;

          if (e.eventType === 'click' && e.targetElement) {
            const formatted = formatClickDescriptor(e.targetElement);
            clickMap[formatted] = (clickMap[formatted] || 0) + 1;
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
            const exitKey = e.domain && e.domain !== 'localhost' && !e.domain.includes('127.0.0.1')
              ? `${e.domain}${cleanExitPath}`
              : cleanExitPath;
            exitMap[exitKey] = (exitMap[exitKey] || 0) + 1;
          }

          if (e.timeOnPageSeconds && Number(e.timeOnPageSeconds) > 0 && e.path) {
            const cleanPath = e.path || '/';
            const fullPath = e.domain && e.domain !== 'localhost' && !e.domain.includes('127.0.0.1')
              ? `${e.domain}${cleanPath}`
              : cleanPath;
            if (!pageTimeMap[fullPath]) pageTimeMap[fullPath] = { count: 0, totalSeconds: 0 };
            pageTimeMap[fullPath].count += 1;
            pageTimeMap[fullPath].totalSeconds += Number(e.timeOnPageSeconds);
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
      .slice(0, 5);

    const topPages = Object.entries(pagePathMap)
      .map(([path, views]) => {
        const timeData = pageTimeMap[path];
        const avgTimeSeconds = timeData && timeData.count > 0 
          ? Math.round(timeData.totalSeconds / timeData.count) 
          : 0;
        return { path, views, avgTimeSeconds };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

    const topClicks = Object.entries(clickMap)
      .map(([element, count]) => ({ element, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const rageClicks = Object.entries(rageClickMap)
      .map(([element, count]) => ({ element, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topErrors = Object.values(errorMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const conversions = Object.entries(conversionMap)
      .map(([goalName, count]) => ({ goalName, count }))
      .sort((a, b) => b.count - a.count);

    const topExits = Object.entries(exitMap)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const subdomainBreakdown = Object.entries(subdomainMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const utmCampaigns = Object.entries(utmMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const avgDuration = totalSessions > 0 ? Math.round(totalDurationSeconds / totalSessions) : 0;
    const bounceRate = totalSessions > 0 ? Math.round((totalBounceSessions / totalSessions) * 100) : 0;

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

module.exports = {
  collectAnalyticsEvent,
  getAnalyticsStats
};
