const crypto = require('crypto');
const path = require('path');
const cron = require('node-cron');
const {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} = require('firebase/firestore');
const { getDatabase } = require('../config/database');
const { initAdmin } = require('../config/firebaseAdmin');
const { getEmailTransporter } = require('../config/email');
const { hasRole } = require('../utils/profileRoles');

const CAMPAIGNS_COLLECTION = 'campaigns';
const TEMPLATES_COLLECTION = 'campaign_templates';
const UNSUBSCRIBES_COLLECTION = 'campaign_unsubscribes';
const PROFILES_COLLECTION = 'profiles';
const BOOKINGS_COLLECTION = 'bookings';
const DISPUTES_COLLECTION = 'disputes';

const UNSUBSCRIBE_SECRET =
  process.env.EMAIL_UNSUBSCRIBE_SECRET ||
  process.env.JWT_SECRET ||
  'ultrahealers-unsubscribe-secret-v1';

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const toIsoOrNull = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return null;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const signUnsubscribeToken = (payload) => {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
};

const verifyUnsubscribeToken = (token) => {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const deriveAudienceLabel = (segments = [], audienceFilter = {}, customRecipients = []) => {
  if (Array.isArray(segments) && segments.length > 0) {
    const map = {
      'all-healers': 'Healers',
      'all-seekers': 'Seekers',
      'all-users': 'All Users',
      'free-healers': 'Free Healers',
      'premium-healers': 'Premium Healers',
      'inactive-healers': 'Healers',
      'new-healers': 'Healers',
      'inactive-seekers': 'Seekers',
      'disputed-seekers': 'Seekers',
    };
    const first = map[segments[0]];
    if (first) return first;
  }
  if (audienceFilter?.role === 'healer') {
    if (audienceFilter.subscriptionType === 'premium') return 'Premium Healers';
    if (audienceFilter.subscriptionType === 'free') return 'Free Healers';
    return 'Healers';
  }
  if (audienceFilter?.role === 'seeker') return 'Seekers';
  if (Array.isArray(customRecipients) && customRecipients.length > 0) return 'Custom';
  return 'All Users';
};

const resolveAudienceRecipients = async (db, filters = {}) => {
  const {
    role,
    subscriptionType,
    noBookingsInLastDays,
    joinedInLastDays,
    hasPendingDisputes,
    modalities,
    regions,
    customRecipients,
    excludeUnsubscribed = true,
  } = filters || {};

  const unsubscribedSet = new Set();
  if (excludeUnsubscribed !== false) {
    const unsubSnap = await getDocs(collection(db, UNSUBSCRIBES_COLLECTION));
    unsubSnap.docs.forEach((d) => {
      const email = normalizeEmail(d.data()?.email);
      if (email) unsubscribedSet.add(email);
    });
  }

  const recipientMap = new Map();

  // 1. Add custom recipients (selected users or CSV emails) if provided
  if (Array.isArray(customRecipients)) {
    customRecipients.forEach((rawItem) => {
      const rawEmail = typeof rawItem === 'string' ? rawItem : rawItem?.email;
      const email = normalizeEmail(rawEmail);
      if (email && email.includes('@') && !unsubscribedSet.has(email)) {
        const providedName = typeof rawItem === 'object' && rawItem?.name ? String(rawItem.name).trim() : '';
        const name = providedName || email.split('@')[0];
        recipientMap.set(email, {
          email,
          name,
          firstName: name.split(' ')[0] || 'there',
        });
      }
    });
  }

  // 2. Query Firestore profiles when any segment or filter is active
  const hasProfileCriteria = Boolean(
    role ||
      subscriptionType ||
      noBookingsInLastDays ||
      joinedInLastDays ||
      hasPendingDisputes ||
      (Array.isArray(modalities) && modalities.length > 0) ||
      (Array.isArray(regions) && regions.length > 0)
  );

  if (hasProfileCriteria) {
    const profilesSnap = await getDocs(collection(db, PROFILES_COLLECTION));

    let recentBookingUserIds = null;
    if (noBookingsInLastDays) {
      const cutoffIso = new Date(Date.now() - Number(noBookingsInLastDays) * 86400000).toISOString();
      const bookingsSnap = await getDocs(collection(db, BOOKINGS_COLLECTION));
      recentBookingUserIds = new Set();
      bookingsSnap.docs.forEach((bDoc) => {
        const b = bDoc.data() || {};
        const createdAt = toIsoOrNull(b.createdAt || b.created_at);
        if (createdAt && createdAt >= cutoffIso) {
          if (b.healerId) recentBookingUserIds.add(b.healerId);
          if (b.seekerId) recentBookingUserIds.add(b.seekerId);
        }
      });
    }

    let pendingDisputeSeekerIds = null;
    if (hasPendingDisputes) {
      const disputesSnap = await getDocs(collection(db, DISPUTES_COLLECTION));
      pendingDisputeSeekerIds = new Set();
      disputesSnap.docs.forEach((dDoc) => {
        const d = dDoc.data() || {};
        const status = String(d.status || '').toLowerCase();
        if (!status.startsWith('resolved') && status !== 'denied' && status !== 'closed') {
          if (d.seekerId) pendingDisputeSeekerIds.add(d.seekerId);
        }
      });
    }

    const joinedCutoffIso = joinedInLastDays
      ? new Date(Date.now() - Number(joinedInLastDays) * 86400000).toISOString()
      : null;

    profilesSnap.docs.forEach((pDoc) => {
      const p = pDoc.data() || {};
      const email = normalizeEmail(p.email || p.contact_email);
      if (!email || !email.includes('@')) return;
      if (unsubscribedSet.has(email)) return;

      // Exclude deleted/suspended accounts
      const acctStatus = String(p.status || p.account_status || '').toLowerCase();
      if (acctStatus === 'deleted' || p.is_deleted === true || p.deleted === true) return;

      // Role filter
      if (role && role !== 'all') {
        if (role === 'healer' && !hasRole(p, 'healer')) return;
        if (role === 'seeker' && !hasRole(p, 'seeker')) return;
      }

      // Subscription type filter
      if (subscriptionType) {
        const isPremium = p.subscription_type === 'premium' || Boolean(p.isPremium || p.is_premium);
        if (subscriptionType === 'premium' && !isPremium) return;
        if (subscriptionType === 'free' && isPremium) return;
      }

      // Inactive filter (no bookings in last N days)
      if (recentBookingUserIds && recentBookingUserIds.has(pDoc.id)) return;

      // Joined in last N days
      if (joinedCutoffIso) {
        const createdAt = toIsoOrNull(p.created_at || p.createdAt);
        if (!createdAt || createdAt < joinedCutoffIso) return;
      }

      // Pending disputes filter
      if (pendingDisputeSeekerIds && !pendingDisputeSeekerIds.has(pDoc.id)) return;

      // Modalities filter
      if (Array.isArray(modalities) && modalities.length > 0) {
        const userModalities = [
          ...(Array.isArray(p.modalities) ? p.modalities : []),
          ...(Array.isArray(p.specialties) ? p.specialties : []),
          p.modality,
        ]
          .filter(Boolean)
          .map((m) => String(m).toLowerCase());
        const wanted = modalities.map((m) => String(m).toLowerCase());
        if (!wanted.some((w) => userModalities.some((um) => um.includes(w)))) return;
      }

      // Regions filter
      if (Array.isArray(regions) && regions.length > 0) {
        const loc = [p.region, p.country, p.location, p.city].filter(Boolean).join(' ').toLowerCase();
        const wanted = regions.map((r) => String(r).toLowerCase());
        if (!wanted.some((w) => loc.includes(w))) return;
      }

      const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.display_name || p.name || email.split('@')[0];
      const firstName = p.first_name || fullName.split(' ')[0] || 'there';

      recipientMap.set(email, {
        id: pDoc.id,
        email,
        name: fullName,
        firstName,
      });
    });
  }

  return Array.from(recipientMap.values());
};

const personalizeText = (text, recipient) => {
  let out = String(text || '');
  out = out.replace(/\{\{\s*first_name\s*\}\}/gi, recipient.firstName || 'there');
  out = out.replace(/\{\{\s*name\s*\}\}/gi, recipient.name || 'there');
  out = out.replace(/\{\{\s*email\s*\}\}/gi, recipient.email || '');
  return out;
};

const personalizeHtml = (html, recipient, unsubscribeUrl, trackingPixelUrl, previewText = '') => {
  const body = personalizeText(html, recipient);
  const resolvedPreview = personalizeText(previewText, recipient).trim();
  const escapedPreview = resolvedPreview
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const preheader = escapedPreview
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapedPreview}${'&nbsp;&zwnj;'.repeat(40)}</div>`
    : '';

  const footer = `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
      <p style="margin:0 0 8px 0;">You received this email from UltraHealers.</p>
      <a href="${unsubscribeUrl}" style="color:#4318FF;text-decoration:underline;">Unsubscribe from marketing emails</a>
    </div>
    ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" alt="" width="1" height="1" style="display:none;width:1px;height:1px;" />` : ''}
  `;

  return `${preheader}${body}${footer}`;
};

const mapCampaignDoc = (docSnap) => {
  const data = docSnap.data() || {};
  const metrics = data.metrics || { sent: 0, delivered: 0, opens: 0, clicks: 0, bounced: 0, unsubscribed: 0 };
  const sent = Number(metrics.sent || 0);
  const opens = Number(metrics.opens || 0);
  const clicks = Number(metrics.clicks || 0);

  return {
    id: docSnap.id,
    title: data.title || data.name || 'Untitled Campaign',
    name: data.title || data.name || 'Untitled Campaign',
    subject: data.subject || '',
    previewText: data.previewText || '',
    fromName: data.fromName || 'UltraHealers Team',
    fromEmail: data.fromEmail || process.env.EMAIL_USER || 'hello@ultrahealers.com',
    content: data.content || '',
    status: data.status || 'draft',
    audience: data.audience || deriveAudienceLabel(data.segments, data.audienceFilter, data.customRecipients),
    segments: Array.isArray(data.segments) ? data.segments : [],
    customRecipients: Array.isArray(data.customRecipients) ? data.customRecipients : [],
    audienceFilter: data.audienceFilter || {},
    recipientCount: Number(data.recipientCount || sent || 0),
    metrics: {
      sent,
      delivered: Number(metrics.delivered || sent),
      opens,
      clicks,
      bounced: Number(metrics.bounced || 0),
      unsubscribed: Number(metrics.unsubscribed || 0),
      spam: Number(metrics.spam || 0),
    },
    openRate: sent > 0 ? Number(((opens / sent) * 100).toFixed(1)) : 0,
    clickRate: sent > 0 ? Number(((clicks / sent) * 100).toFixed(1)) : 0,
    scheduledAt: toIsoOrNull(data.scheduledAt),
    sentAt: toIsoOrNull(data.sentAt),
    createdAt: toIsoOrNull(data.createdAt),
    updatedAt: toIsoOrNull(data.updatedAt),
    createdBy: data.createdBy || 'Admin',
    activityLog: Array.isArray(data.activityLog) ? data.activityLog : [],
  };
};

// --- Controllers ---

const listCampaigns = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const snap = await getDocs(collection(db, CAMPAIGNS_COLLECTION));
    let campaigns = snap.docs
      .map(mapCampaignDoc)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    const { search, status, audience, createdBy, startDate, endDate } = req.query;

    if (search) {
      const q = String(search).toLowerCase().trim();
      campaigns = campaigns.filter(
        (c) => c.title.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q)
      );
    }
    if (status && status !== 'All') {
      campaigns = campaigns.filter((c) => c.status.toLowerCase() === String(status).toLowerCase());
    }
    if (audience && audience !== 'All') {
      campaigns = campaigns.filter((c) => c.audience.toLowerCase() === String(audience).toLowerCase());
    }
    if (createdBy) {
      const q = String(createdBy).toLowerCase().trim();
      campaigns = campaigns.filter((c) => c.createdBy.toLowerCase().includes(q));
    }
    if (startDate) {
      const startMs = new Date(`${startDate}T00:00:00.000`).getTime();
      campaigns = campaigns.filter((c) => {
        const ts = c.sentAt || c.createdAt;
        return ts && new Date(ts).getTime() >= startMs;
      });
    }
    if (endDate) {
      const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
      campaigns = campaigns.filter((c) => {
        const ts = c.sentAt || c.createdAt;
        return ts && new Date(ts).getTime() <= endMs;
      });
    }

    return res.json({ success: true, campaigns, total: campaigns.length });
  } catch (error) {
    console.error('❌ Error listing campaigns:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getCampaignById = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const snap = await getDoc(doc(db, CAMPAIGNS_COLLECTION, req.params.id));
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    return res.json({ success: true, campaign: mapCampaignDoc(snap) });
  } catch (error) {
    console.error('❌ Error getting campaign:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const createCampaign = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const body = req.body || {};
    const now = new Date().toISOString();
    const audienceFilter = body.audienceFilter || {};
    const segments = Array.isArray(body.segments) ? body.segments : [];
    const customRecipients = Array.isArray(body.customRecipients) ? body.customRecipients : [];

    let recipientCount = Number(body.recipientCount || 0);
    if (!recipientCount && (Object.keys(audienceFilter).length > 0 || customRecipients.length > 0)) {
      const recipients = await resolveAudienceRecipients(db, { ...audienceFilter, customRecipients });
      recipientCount = recipients.length;
    }

    const docData = {
      title: body.title || body.name || 'Untitled Campaign',
      subject: body.subject || '',
      previewText: body.previewText || '',
      fromName: body.fromName || 'UltraHealers Team',
      fromEmail: body.fromEmail || process.env.EMAIL_USER || 'hello@ultrahealers.com',
      content: body.content || '',
      status: body.status || 'draft',
      audience: body.audience || deriveAudienceLabel(segments, audienceFilter, customRecipients),
      segments,
      customRecipients,
      audienceFilter,
      recipientCount,
      scheduledAt: body.scheduledAt || null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: body.createdBy || 'Admin',
      metrics: body.metrics || { sent: 0, delivered: 0, opens: 0, clicks: 0, bounced: 0, unsubscribed: 0, spam: 0 },
      activityLog: [
        {
          id: `evt_${Date.now()}`,
          event: 'Campaign Created',
          user: body.createdBy || 'Admin',
          time: now,
          type: 'created',
        },
      ],
    };

    const ref = await addDoc(collection(db, CAMPAIGNS_COLLECTION), docData);
    const created = { id: ref.id, ...docData };

    return res.status(201).json({
      success: true,
      campaignId: ref.id,
      campaign: created,
    });
  } catch (error) {
    console.error('❌ Error creating campaign:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateCampaign = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const ref = doc(db, CAMPAIGNS_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const body = req.body || {};
    const existing = snap.data() || {};
    const segments = Array.isArray(body.segments) ? body.segments : existing.segments || [];
    const customRecipients = Array.isArray(body.customRecipients) ? body.customRecipients : existing.customRecipients || [];
    const audienceFilter = body.audienceFilter !== undefined ? body.audienceFilter : existing.audienceFilter || {};

    const updates = {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.name !== undefined && { title: body.name }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.previewText !== undefined && { previewText: body.previewText }),
      ...(body.fromName !== undefined && { fromName: body.fromName }),
      ...(body.fromEmail !== undefined && { fromEmail: body.fromEmail }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.scheduledAt !== undefined && { scheduledAt: body.scheduledAt }),
      segments,
      customRecipients,
      audienceFilter,
      audience: body.audience || deriveAudienceLabel(segments, audienceFilter, customRecipients),
      updatedAt: new Date().toISOString(),
    };

    if (body.audienceFilter !== undefined || body.customRecipients !== undefined) {
      const recipients = await resolveAudienceRecipients(db, { ...audienceFilter, customRecipients });
      updates.recipientCount = recipients.length;
    }

    await updateDoc(ref, updates);
    const updatedSnap = await getDoc(ref);

    return res.json({
      success: true,
      campaign: mapCampaignDoc(updatedSnap),
    });
  } catch (error) {
    console.error('❌ Error updating campaign:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteCampaign = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const ref = doc(db, CAMPAIGNS_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    await deleteDoc(ref);
    return res.json({ success: true, id, deleted: true });
  } catch (error) {
    console.error('❌ Error deleting campaign:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const previewAudience = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const recipients = await resolveAudienceRecipients(db, req.body || {});
    return res.json({
      success: true,
      count: recipients.length,
      sample: recipients.slice(0, 5).map((r) => ({ name: r.name, email: r.email })),
      recipients: recipients.map((r) => ({ id: r.id || null, name: r.name, email: r.email })),
    });
  } catch (error) {
    console.error('❌ Error previewing campaign audience:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const searchCampaignUsers = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const q = String(req.query.q || '').toLowerCase().trim();
    const roleFilter = String(req.query.role || 'all').toLowerCase().trim();

    const profilesSnap = await getDocs(collection(db, PROFILES_COLLECTION));
    const users = [];

    profilesSnap.docs.forEach((pDoc) => {
      const p = pDoc.data() || {};
      const email = normalizeEmail(p.email || p.contact_email);
      if (!email || !email.includes('@')) return;

      const acctStatus = String(p.status || p.account_status || '').toLowerCase();
      if (acctStatus === 'deleted' || p.is_deleted === true || p.deleted === true) return;

      const isHealer = hasRole(p, 'healer');
      const isSeeker = hasRole(p, 'seeker');

      if (roleFilter === 'healer' && !isHealer) return;
      if (roleFilter === 'seeker' && !isSeeker) return;

      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.display_name || p.name || email.split('@')[0];

      if (q) {
        const haystack = `${name} ${email} ${pDoc.id}`.toLowerCase();
        if (!haystack.includes(q)) return;
      }

      const roleLabel = isHealer && isSeeker ? 'Healer & Seeker' : isHealer ? 'Healer' : isSeeker ? 'Seeker' : 'User';
      users.push({
        id: pDoc.id,
        name,
        email,
        role: roleLabel,
      });
    });

    users.sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      users: users.slice(0, 50),
      total: users.length,
    });
  } catch (error) {
    console.error('❌ Error searching campaign users:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const dispatchCampaign = async (db, campaignId, reqBaseUrl = '') => {
  const ref = doc(db, CAMPAIGNS_COLLECTION, campaignId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Campaign not found');
  }

  const campaign = snap.data() || {};
  const transporter = getEmailTransporter();
  if (!transporter) {
    throw new Error('Email transporter is not configured on the server (check EMAIL_USER and EMAIL_PASS)');
  }

  const recipients = await resolveAudienceRecipients(db, {
    ...(campaign.audienceFilter || {}),
    customRecipients: campaign.customRecipients || [],
  });

  if (recipients.length === 0) {
    throw new Error('No eligible recipients matched the selected audience');
  }

  const startedAt = new Date().toISOString();
  const existingLog = Array.isArray(campaign.activityLog) ? campaign.activityLog : [];

  await updateDoc(ref, {
    status: 'sending',
    recipientCount: recipients.length,
    updatedAt: startedAt,
  });

  const adminAppUrl = (process.env.ADMIN_CONSOLE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const apiBaseUrl = (process.env.BACKEND_PUBLIC_URL || reqBaseUrl || '').replace(/\/$/, '');

  // Strict sender alignment per LESSON-002
  const senderDisplayName = campaign.fromName || 'UltraHealers Team';
  const fromAddress = process.env.EMAIL_USER
    ? `"${senderDisplayName}" <${process.env.EMAIL_USER}>`
    : (process.env.EMAIL_FROM || campaign.fromEmail);
  const replyTo = campaign.fromEmail || process.env.EMAIL_USER || undefined;

  let sent = 0;
  let bounced = 0;
  const newLogs = [
    {
      id: `evt_launch_${Date.now()}`,
      event: `Campaign Launched (${recipients.length} recipients)`,
      user: campaign.createdBy || 'Admin',
      time: startedAt,
      type: 'sent',
    },
  ];

  // Send in small sequential batches to avoid SMTP rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (recipient) => {
        try {
          const token = signUnsubscribeToken({
            email: recipient.email,
            name: recipient.name,
            campaignId,
            sourceCampaign: campaign.title || 'Campaign',
          });
          const unsubscribeUrl = `${adminAppUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
          const trackingPixelUrl = apiBaseUrl
            ? `${apiBaseUrl}/api/campaigns/track/open/${campaignId}?email=${encodeURIComponent(recipient.email)}`
            : '';

          const html = personalizeHtml(
            campaign.content || '',
            recipient,
            unsubscribeUrl,
            trackingPixelUrl,
            campaign.previewText || ''
          );
          const resolvedSubject = personalizeText(
            campaign.subject || campaign.title || 'Update from UltraHealers',
            recipient
          );

          await transporter.sendMail({
            from: fromAddress,
            replyTo,
            to: recipient.email,
            subject: resolvedSubject,
            html,
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
            },
          });
          sent += 1;
        } catch (err) {
          bounced += 1;
          newLogs.push({
            id: `evt_bounce_${Date.now()}_${bounced}`,
            event: `Delivery Failed: ${err.message || 'SMTP error'}`,
            user: recipient.email,
            time: new Date().toISOString(),
            type: 'bounce',
          });
        }
      })
    );
  }

  const finishedAt = new Date().toISOString();
  const finalStatus = sent === 0 && bounced > 0 ? 'failed' : 'sent';

  await updateDoc(ref, {
    status: finalStatus,
    sentAt: finishedAt,
    updatedAt: finishedAt,
    recipientCount: recipients.length,
    metrics: {
      ...(campaign.metrics || {}),
      sent,
      delivered: sent,
      bounced,
      opens: Number(campaign.metrics?.opens || 0),
      clicks: Number(campaign.metrics?.clicks || 0),
      unsubscribed: Number(campaign.metrics?.unsubscribed || 0),
      spam: Number(campaign.metrics?.spam || 0),
    },
    activityLog: [...newLogs, ...existingLog].slice(0, 100),
  });

  return { status: finalStatus, sent, bounced, total: recipients.length };
};

const sendCampaignNow = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const reqBaseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await dispatchCampaign(db, req.params.id, reqBaseUrl);

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Error sending campaign:', error);
    return res.status(400).json({ success: false, error: error.message });
  }
};

const sendCampaignTestEmail = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { email } = req.body || {};
    const targetEmail = normalizeEmail(email);
    if (!targetEmail || !targetEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid recipient email is required' });
    }

    const transporter = getEmailTransporter();
    if (!transporter) {
      return res.status(500).json({
        success: false,
        error: 'Email transporter is not configured on the server (check EMAIL_USER and EMAIL_PASS)',
      });
    }

    const snap = await getDoc(doc(db, CAMPAIGNS_COLLECTION, req.params.id));
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign = snap.data() || {};
    const senderDisplayName = campaign.fromName || 'UltraHealers Team';
    const fromAddress = process.env.EMAIL_USER
      ? `"${senderDisplayName}" <${process.env.EMAIL_USER}>`
      : (process.env.EMAIL_FROM || campaign.fromEmail);
    const replyTo = campaign.fromEmail || process.env.EMAIL_USER || undefined;

    const adminAppUrl = (process.env.ADMIN_CONSOLE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const token = signUnsubscribeToken({
      email: targetEmail,
      name: 'Test Recipient',
      campaignId: req.params.id,
      sourceCampaign: campaign.title || 'Test Campaign',
    });
    const unsubscribeUrl = `${adminAppUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

    const testRecipient = { email: targetEmail, name: 'Test Recipient', firstName: 'Test' };
    const html = personalizeHtml(
      campaign.content || '<p>Test email body</p>',
      testRecipient,
      unsubscribeUrl,
      '',
      campaign.previewText || ''
    );
    const resolvedSubject = personalizeText(
      campaign.subject || campaign.title || 'Campaign Preview',
      testRecipient
    );

    await transporter.sendMail({
      from: fromAddress,
      replyTo,
      to: targetEmail,
      subject: `[TEST] ${resolvedSubject}`,
      html,
    });

    return res.json({ success: true, sentTo: targetEmail });
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// --- Open Tracking Pixel ---
const trackCampaignOpen = async (req, res) => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.send(TRANSPARENT_GIF);

  try {
    const db = getDatabase();
    if (!db) return;
    const { id } = req.params;
    const email = normalizeEmail(req.query.email);
    const ref = doc(db, CAMPAIGNS_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const openedEmails = Array.isArray(data.openedEmails) ? data.openedEmails : [];
    const isNewOpen = email ? !openedEmails.includes(email) : true;
    const metrics = data.metrics || {};

    if (isNewOpen) {
      const nextOpened = email ? [...openedEmails, email] : openedEmails;
      const existingLog = Array.isArray(data.activityLog) ? data.activityLog : [];
      await updateDoc(ref, {
        openedEmails: nextOpened,
        metrics: {
          ...metrics,
          opens: Number(metrics.opens || 0) + 1,
        },
        activityLog: [
          {
            id: `evt_open_${Date.now()}`,
            event: 'Email Opened',
            user: email || 'Recipient',
            time: new Date().toISOString(),
            type: 'open',
          },
          ...existingLog,
        ].slice(0, 100),
      });
    }
  } catch (err) {
    console.warn('⚠️ Failed to record campaign open:', err.message);
  }
};

// --- Templates CRUD ---

const DEFAULT_TEMPLATES = [
  {
    name: 'Welcome Email (Healer)',
    category: 'Onboarding',
    description: 'Introduce new healers to the platform and help them set up their profile.',
    previewImage: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=400&q=80',
    content: '<h2>Welcome to UltraHealers, {{first_name}}!</h2><p>We are thrilled to have you join our community of holistic practitioners. Complete your profile and publish your first listing to start connecting with seekers.</p>',
  },
  {
    name: 'Premium Upgrade',
    category: 'Marketing',
    description: 'Promote the benefits of premium membership to free healers.',
    previewImage: 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?auto=format&fit=crop&w=400&q=80',
    content: '<h2>Unlock Premium Visibility, {{first_name}}</h2><p>Upgrade to UltraHealers Premium to boost your search ranking, showcase retreats, and reach more seekers.</p>',
  },
  {
    name: 'New Retreat Launch',
    category: 'Marketing',
    description: 'Announce upcoming seasonal wellness retreats to seekers.',
    previewImage: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=400&q=80',
    content: '<h2>Discover Our Upcoming Retreats, {{first_name}}</h2><p>Explore transformative wellness retreats hosted by verified healers around the world.</p>',
  },
  {
    name: 'Monthly Wellness Newsletter',
    category: 'Content',
    description: 'A clean layout for sharing platform news, modalities, and featured healers.',
    previewImage: 'https://images.unsplash.com/photo-1586769852044-692d6e3703a0?auto=format&fit=crop&w=400&q=80',
    content: '<h2>Monthly Wellness Digest</h2><p>Hello {{first_name}}, here are this month\'s highlights, featured healers, and upcoming sessions on UltraHealers.</p>',
  },
];

const listTemplates = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    let snap = await getDocs(collection(db, TEMPLATES_COLLECTION));
    if (snap.empty) {
      const now = new Date().toISOString();
      await Promise.all(
        DEFAULT_TEMPLATES.map((tpl) =>
          addDoc(collection(db, TEMPLATES_COLLECTION), {
            ...tpl,
            createdAt: now,
            updatedAt: now,
          })
        )
      );
      snap = await getDocs(collection(db, TEMPLATES_COLLECTION));
    }

    const templates = snap.docs
      .map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          name: data.name || 'Untitled Template',
          category: data.category || 'Marketing',
          description: data.description || '',
          previewImage: data.previewImage || '',
          content: data.content || '',
          fields: data.fields || null,
          createdAt: toIsoOrNull(data.createdAt),
          updatedAt: toIsoOrNull(data.updatedAt),
        };
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    return res.json({ success: true, templates });
  } catch (error) {
    console.error('❌ Error listing templates:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const createTemplate = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const body = req.body || {};
    const now = new Date().toISOString();
    const docData = {
      name: body.name || 'Untitled Template',
      category: body.category || 'Marketing',
      description: body.description || '',
      previewImage: body.previewImage || '',
      content: body.content || `<p>Hello {{first_name}},</p>`,
      fields: body.fields || null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await addDoc(collection(db, TEMPLATES_COLLECTION), docData);
    return res.status(201).json({ success: true, template: { id: ref.id, ...docData } });
  } catch (error) {
    console.error('❌ Error creating template:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const ref = doc(db, TEMPLATES_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    const body = req.body || {};
    const updates = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.previewImage !== undefined && { previewImage: body.previewImage }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.fields !== undefined && { fields: body.fields }),
      updatedAt: new Date().toISOString(),
    };

    await updateDoc(ref, updates);
    const updatedSnap = await getDoc(ref);
    return res.json({ success: true, template: { id: updatedSnap.id, ...updatedSnap.data() } });
  } catch (error) {
    console.error('❌ Error updating template:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const ref = doc(db, TEMPLATES_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    await deleteDoc(ref);
    return res.json({ success: true, id, deleted: true });
  } catch (error) {
    console.error('❌ Error deleting template:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// --- Unsubscribes CRUD + Public Unsubscribe ---

const listUnsubscribes = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const snap = await getDocs(collection(db, UNSUBSCRIBES_COLLECTION));
    const unsubscribes = snap.docs
      .map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          email: data.email || d.id,
          name: data.name || 'Unknown User',
          date: toIsoOrNull(data.date || data.unsubscribedAt) || new Date().toISOString(),
          sourceCampaign: data.sourceCampaign || 'Direct',
          campaignId: data.campaignId || null,
        };
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return res.json({ success: true, unsubscribes });
  } catch (error) {
    console.error('❌ Error listing unsubscribes:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const resubscribeUser = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const ref = doc(db, UNSUBSCRIBES_COLLECTION, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Unsubscribe record not found' });
    }

    await deleteDoc(ref);
    return res.json({ success: true, id, resubscribed: true });
  } catch (error) {
    console.error('❌ Error re-subscribing user:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const processUnsubscribe = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { token } = req.body || {};
    const payload = verifyUnsubscribeToken(token);
    if (!payload || !payload.email) {
      return res.status(400).json({ success: false, error: 'Invalid or expired unsubscribe link' });
    }

    const email = normalizeEmail(payload.email);
    const now = new Date().toISOString();
    const docId = Buffer.from(email).toString('base64url');

    await setDoc(doc(db, UNSUBSCRIBES_COLLECTION, docId), {
      email,
      name: payload.name || email.split('@')[0],
      sourceCampaign: payload.sourceCampaign || 'Email Campaign',
      campaignId: payload.campaignId || null,
      date: now,
      unsubscribedAt: now,
    });

    if (payload.campaignId) {
      try {
        const campaignRef = doc(db, CAMPAIGNS_COLLECTION, payload.campaignId);
        const campaignSnap = await getDoc(campaignRef);
        if (campaignSnap.exists()) {
          const data = campaignSnap.data() || {};
          const metrics = data.metrics || {};
          const existingLog = Array.isArray(data.activityLog) ? data.activityLog : [];
          await updateDoc(campaignRef, {
            metrics: {
              ...metrics,
              unsubscribed: Number(metrics.unsubscribed || 0) + 1,
            },
            activityLog: [
              {
                id: `evt_unsub_${Date.now()}`,
                event: 'Unsubscribe Request',
                user: email,
                time: now,
                type: 'unsubscribe',
              },
              ...existingLog,
            ].slice(0, 100),
          });
        }
      } catch (err) {
        console.warn('⚠️ Failed to update campaign unsubscribe metric:', err.message);
      }
    }

    return res.json({ success: true, email });
  } catch (error) {
    console.error('❌ Error processing unsubscribe:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// --- Image Upload to Firebase Storage via Firebase Admin SDK (no browser CORS issues) ---

const ALLOWED_IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const uploadBufferToBucket = async (adminApp, bucketName, filePath, buffer, contentType, downloadToken) => {
  const bucket = adminApp.storage().bucket(bucketName);
  const file = bucket.file(filePath);
  await file.save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      contentType,
      cacheControl: 'public, max-age=31536000',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
};

const uploadCampaignImage = async (req, res) => {
  try {
    const { dataUrl, fileName = 'image', folder = 'campaigns' } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing image data' });
    }

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Invalid image format' });
    }

    const contentType = match[1].toLowerCase();
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    if (!ext) {
      return res.status(400).json({ success: false, error: 'Unsupported image type. Use PNG, JPG, GIF, or WebP.' });
    }

    const buffer = Buffer.from(match[2], 'base64');
    const MAX_BYTES = 5 * 1024 * 1024;
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ success: false, error: 'Image must be 5MB or smaller.' });
    }

    const safeFolder = String(folder).replace(/[^a-zA-Z0-9_-]/g, '') || 'campaigns';
    const baseName = path.basename(String(fileName), path.extname(String(fileName))).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'image';
    const filePath = `${safeFolder}/${Date.now()}_${baseName}${ext}`;
    const downloadToken = crypto.randomUUID();

    const adminApp = initAdmin();
    const projectId = process.env.FIREBASE_PROJECT_ID || adminApp.app().options.projectId;
    const configuredBucket = process.env.FIREBASE_STORAGE_BUCKET || adminApp.app().options.storageBucket;

    const candidateBuckets = Array.from(
      new Set(
        [
          configuredBucket,
          projectId ? `${projectId}.firebasestorage.app` : null,
          projectId ? `${projectId}.appspot.com` : null,
        ].filter(Boolean)
      )
    );

    if (candidateBuckets.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'FIREBASE_STORAGE_BUCKET is not configured on the server.',
      });
    }

    let publicUrl = null;
    let lastError = null;

    for (const bucketName of candidateBuckets) {
      try {
        publicUrl = await uploadBufferToBucket(adminApp, bucketName, filePath, buffer, contentType, downloadToken);
        break;
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || '').toLowerCase();
        const isNotFound = err?.code === 404 || msg.includes('not exist') || msg.includes('not found');
        if (!isNotFound) throw err;
      }
    }

    if (!publicUrl) {
      throw lastError || new Error('Failed to upload image to Firebase Storage');
    }

    return res.status(201).json({ success: true, url: publicUrl });
  } catch (error) {
    console.error('❌ Error uploading campaign image to Firebase Storage:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// --- Scheduled Campaign Dispatcher ---
let campaignSchedulerStarted = false;

const initializeCampaignScheduler = () => {
  if (campaignSchedulerStarted) return;
  campaignSchedulerStarted = true;

  cron.schedule('* * * * *', async () => {
    try {
      const db = getDatabase();
      if (!db) return;

      const scheduledSnap = await getDocs(
        query(collection(db, CAMPAIGNS_COLLECTION), where('status', '==', 'scheduled'))
      );
      if (scheduledSnap.empty) return;

      const nowIso = new Date().toISOString();
      for (const docSnap of scheduledSnap.docs) {
        const data = docSnap.data() || {};
        const scheduledAt = toIsoOrNull(data.scheduledAt);
        if (scheduledAt && scheduledAt <= nowIso) {
          console.log(`⏰ Dispatching scheduled campaign: ${docSnap.id} (${data.title})`);
          try {
            await dispatchCampaign(db, docSnap.id);
          } catch (err) {
            console.error(`❌ Failed to dispatch scheduled campaign ${docSnap.id}:`, err.message);
            await updateDoc(doc(db, CAMPAIGNS_COLLECTION, docSnap.id), {
              status: 'failed',
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ Campaign scheduler error:', error.message);
    }
  });

  console.log('✅ Campaign scheduler initialized');
};

module.exports = {
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  previewAudience,
  searchCampaignUsers,
  sendCampaignNow,
  sendCampaignTestEmail,
  trackCampaignOpen,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listUnsubscribes,
  resubscribeUser,
  processUnsubscribe,
  uploadCampaignImage,
  initializeCampaignScheduler,
};
