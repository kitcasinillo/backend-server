const { collection, deleteDoc, doc, getDoc, getDocs, limit, query, updateDoc, where } = require('firebase/firestore');
const { getDatabase } = require('../config/database');

const RETREAT_LISTINGS_COLLECTION = 'retreat_listings';
const BOOKINGS_COLLECTION = 'bookings';
const PROFILES_COLLECTION = 'profiles';

const toIsoOrNull = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return null;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeStatus = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'draft';
  if (['active', 'approved', 'published', 'live'].includes(raw)) return 'active';
  if (['inactive', 'hidden', 'paused'].includes(raw)) return 'inactive';
  if (['full', 'sold_out', 'soldout'].includes(raw)) return 'full';
  if (['finished', 'completed', 'ended', 'done'].includes(raw)) return 'finished';
  if (['pending_review', 'pending', 'review'].includes(raw)) return 'pending_review';
  return raw;
};

const loadProfiles = async (db) => {
  const profileSnap = await getDocs(query(collection(db, PROFILES_COLLECTION), limit(500)));
  return new Map(profileSnap.docs.map((profileDoc) => {
    const data = profileDoc.data() || {};
    const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.display_name || data.name || 'Unknown User';
    return [profileDoc.id, {
      id: profileDoc.id,
      name,
      email: data.email || data.contact_email || '',
      avatar: data.photo_url || data.avatar || '',
    }];
  }));
};

const sanitizeRichText = (value) => typeof value === 'string' ? value.trim() : '';

const buildRetreatBase = (id, data, profileMap) => {
  const host = profileMap.get(data.healerId || data.hostId || data.userId || '') || null;
  const price = toNumber(data.pricePerPerson || data.price, 0);
  const capacity = Math.max(0, toNumber(data.maxParticipants || data.capacity, 0));
  const bookedSpots = Math.max(0, toNumber(data.bookedSpots || data.booked_spots || data.participantsBooked || data.participants, 0));
  const status = normalizeStatus(data.status);

  return {
    id,
    hostId: data.healerId || data.hostId || data.userId || '',
    hostName: data.healerName || data.hostName || host?.name || 'Hosted Retreat',
    hostAvatar: host?.avatar || '',
    hostEmail: data.contactEmail || data.hostEmail || host?.email || '',
    title: data.title || data.name || 'Untitled Retreat',
    location: data.location || data.city || data.country || 'Unknown location',
    startDate: toIsoOrNull(data.startDate || data.start_date),
    endDate: toIsoOrNull(data.endDate || data.end_date),
    price,
    currency: data.currency || 'USD',
    capacity,
    bookedSpots,
    status,
    revenue: bookedSpots * price,
    imageUrl: data.coverImageUrl || (Array.isArray(data.images) && data.images[0]) || '',
    shortDescription: data.description || data.shortDescription || '',
    longDescription: data.detailedDescription || data.longDescription || data.description || '',
    createdAt: toIsoOrNull(data.createdAt || data.created_at),
    updatedAt: toIsoOrNull(data.updatedAt || data.updated_at),
  };
};

const loadRetreatBookings = async (db) => {
  const bookingSnap = await getDocs(query(collection(db, BOOKINGS_COLLECTION), limit(800)));
  return bookingSnap.docs.map((bookingDoc) => ({ id: bookingDoc.id, ...(bookingDoc.data() || {}) }));
};

const groupEnrollmentsByRetreat = (bookings, profileMap) => {
  const grouped = new Map();

  for (const booking of bookings) {
    const joined = [booking.format, booking.modality, booking.listingTitle, booking.title].filter(Boolean).join(' ').toLowerCase();
    const isRetreat = joined.includes('retreat');
    if (!isRetreat || !booking.listingId) continue;

    const seeker = profileMap.get(booking.seekerId || '') || null;
    const enrollment = {
      id: booking.id,
      name: booking.seekerName || seeker?.name || 'Unknown Seeker',
      email: booking.seekerEmail || seeker?.email || '',
      amount: toNumber(booking.amount, 0),
      date: toIsoOrNull(booking.createdAt || booking.created_at || booking.sessionDate),
      status: booking.paymentStatus || 'pending',
      bookingStatus: typeof booking.status === 'string'
        ? booking.status
        : (booking.status?.['booking-marked-as-complete-by-seeker']
          ? 'completed'
          : booking.status?.['booking-confirmed-by-healer']
            ? 'confirmed'
            : 'pending_confirmation'),
    };

    const list = grouped.get(booking.listingId) || [];
    list.push(enrollment);
    grouped.set(booking.listingId, list);
  }

  return grouped;
};

const computeDerivedRetreat = (base, enrollments) => {
  const bookedSpots = Math.max(0, enrollments.length || base.bookedSpots || 0);
  const revenue = enrollments.reduce((sum, item) => sum + toNumber(item.amount, 0), 0);
  const safeRevenue = Number.isFinite(revenue) && revenue > 0 ? revenue : bookedSpots * toNumber(base.price, 0);
  const capacity = Math.max(0, toNumber(base.capacity, 0));
  const status = capacity > 0 && bookedSpots >= capacity ? 'full' : base.status;

  return {
    ...base,
    capacity,
    bookedSpots,
    revenue: Number.isFinite(safeRevenue) ? safeRevenue : 0,
    status,
  };
};

const listAdminRetreats = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const [profileMap, retreatSnap, bookings] = await Promise.all([
      loadProfiles(db),
      getDocs(query(collection(db, RETREAT_LISTINGS_COLLECTION), limit(300))),
      loadRetreatBookings(db),
    ]);

    const enrollmentsByRetreat = groupEnrollmentsByRetreat(bookings, profileMap);
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilters = String(req.query.status || '').split(',').map((v) => v.trim()).filter(Boolean);
    const location = String(req.query.location || '').trim().toLowerCase();
    const priceMin = req.query.priceMin !== undefined ? Number(req.query.priceMin) : undefined;
    const priceMax = req.query.priceMax !== undefined ? Number(req.query.priceMax) : undefined;
    const startDateFrom = String(req.query.startDateFrom || '').trim();
    const startDateTo = String(req.query.startDateTo || '').trim();

    const retreats = retreatSnap.docs
      .map((docSnap) => {
        const base = buildRetreatBase(docSnap.id, docSnap.data() || {}, profileMap);
        const enrollments = enrollmentsByRetreat.get(docSnap.id) || [];
        return computeDerivedRetreat(base, enrollments);
      })
      .filter((item) => {
        if (statusFilters.length > 0 && !statusFilters.includes(item.status)) return false;
        if (search) {
          const haystack = [item.title, item.location, item.hostName, item.hostEmail, item.id].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        if (location && !String(item.location || '').toLowerCase().includes(location)) return false;
        if (priceMin !== undefined && item.price < priceMin) return false;
        if (priceMax !== undefined && item.price > priceMax) return false;
        if (startDateFrom && item.startDate && new Date(item.startDate) < new Date(startDateFrom)) return false;
        if (startDateTo && item.startDate && new Date(item.startDate) > new Date(startDateTo)) return false;
        return true;
      })
      .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));

    const summary = {
      total: retreats.length,
      pending: retreats.filter((item) => item.status === 'pending_review').length,
      active: retreats.filter((item) => item.status === 'active').length,
      finished: retreats.filter((item) => item.status === 'finished').length,
    };

    return res.json({ success: true, retreats, summary });
  } catch (error) {
    console.error('❌ Error listing admin retreats:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getAdminRetreatById = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const [profileMap, retreatSnap, bookings] = await Promise.all([
      loadProfiles(db),
      getDoc(doc(db, RETREAT_LISTINGS_COLLECTION, id)),
      loadRetreatBookings(db),
    ]);

    if (!retreatSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Retreat not found' });
    }

    const base = buildRetreatBase(id, retreatSnap.data() || {}, profileMap);
    const enrollmentsByRetreat = groupEnrollmentsByRetreat(bookings, profileMap);
    const enrollments = (enrollmentsByRetreat.get(id) || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const retreat = computeDerivedRetreat(base, enrollments);

    return res.json({
      success: true,
      retreat: {
        ...retreat,
        enrollments,
      },
    });
  } catch (error) {
    console.error('❌ Error getting admin retreat detail:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateAdminRetreatStatus = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const { status } = req.body || {};
    const normalized = normalizeStatus(status);
    const allowed = new Set(['active', 'inactive', 'draft', 'pending_review', 'full', 'finished']);
    if (!allowed.has(normalized)) {
      return res.status(400).json({ success: false, error: 'Unsupported retreat status' });
    }

    const retreatRef = doc(db, RETREAT_LISTINGS_COLLECTION, id);
    const retreatSnap = await getDoc(retreatRef);
    if (!retreatSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Retreat not found' });
    }

    await updateDoc(retreatRef, {
      status: normalized,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ success: true, data: { id, status: normalized } });
  } catch (error) {
    console.error('❌ Error updating admin retreat status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const approveAdminRetreat = async (req, res) => {
  req.body = { ...(req.body || {}), status: 'active' };
  return updateAdminRetreatStatus(req, res);
};

const updateAdminRetreatFields = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const retreatRef = doc(db, RETREAT_LISTINGS_COLLECTION, id);
    const retreatSnap = await getDoc(retreatRef);
    if (!retreatSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Retreat not found' });
    }

    const payload = req.body || {};
    const updates = {
      title: typeof payload.title === 'string' ? payload.title.trim() : undefined,
      location: typeof payload.location === 'string' ? payload.location.trim() : undefined,
      price: payload.price !== undefined ? toNumber(payload.price, 0) : undefined,
      pricePerPerson: payload.price !== undefined ? toNumber(payload.price, 0) : undefined,
      capacity: payload.capacity !== undefined ? Math.max(0, toNumber(payload.capacity, 0)) : undefined,
      maxParticipants: payload.capacity !== undefined ? Math.max(0, toNumber(payload.capacity, 0)) : undefined,
      startDate: payload.startDate ? String(payload.startDate) : undefined,
      endDate: payload.endDate ? String(payload.endDate) : undefined,
      description: payload.shortDescription !== undefined ? sanitizeRichText(payload.shortDescription) : undefined,
      shortDescription: payload.shortDescription !== undefined ? sanitizeRichText(payload.shortDescription) : undefined,
      detailedDescription: payload.longDescription !== undefined ? sanitizeRichText(payload.longDescription) : undefined,
      longDescription: payload.longDescription !== undefined ? sanitizeRichText(payload.longDescription) : undefined,
      updatedAt: new Date().toISOString(),
    };

    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
    await updateDoc(retreatRef, updates);

    return res.json({ success: true, data: { id, updated: updates } });
  } catch (error) {
    console.error('❌ Error updating retreat fields:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const messageAllRetreatSeekers = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const { subject, message } = req.body || {};
    if (!String(subject || '').trim() || !String(message || '').trim()) {
      return res.status(400).json({ success: false, error: 'subject and message are required' });
    }

    const bookingSnap = await getDocs(query(collection(db, BOOKINGS_COLLECTION), where('listingId', '==', id), limit(500)));
    const recipients = bookingSnap.docs
      .map((docSnap) => docSnap.data() || {})
      .filter((booking) => [booking.format, booking.modality, booking.listingTitle, booking.title].filter(Boolean).join(' ').toLowerCase().includes('retreat'))
      .map((booking) => ({
        seekerId: booking.seekerId || null,
        email: booking.seekerEmail || '',
        name: booking.seekerName || 'Unknown Seeker',
        subject: String(subject).trim(),
        message: String(message).trim(),
      }))
      .filter((recipient) => recipient.email);

    return res.json({
      success: true,
      data: {
        count: recipients.length,
        recipients,
        mode: 'mailto_fallback',
      },
    });
  } catch (error) {
    console.error('❌ Error building retreat seeker message payload:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteAdminRetreat = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const retreatRef = doc(db, RETREAT_LISTINGS_COLLECTION, id);
    const retreatSnap = await getDoc(retreatRef);
    if (!retreatSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Retreat not found' });
    }

    await deleteDoc(retreatRef);
    return res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('❌ Error deleting admin retreat:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  listAdminRetreats,
  getAdminRetreatById,
  updateAdminRetreatStatus,
  approveAdminRetreat,
  updateAdminRetreatFields,
  messageAllRetreatSeekers,
  deleteAdminRetreat,
};
