const { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } = require('firebase/firestore');
const { getDatabase } = require('../config/database');

const BOOKINGS_COLLECTION = 'bookings';
const PROFILES_COLLECTION = 'profiles';
const SESSION_COLLECTION = 'sessions';
const RETREAT_LISTINGS_COLLECTION = 'retreat_listings';

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

const buildParticipantMap = async (db) => {
  const profileSnap = await getDocs(query(collection(db, PROFILES_COLLECTION), limit(500)));
  return new Map(profileSnap.docs.map((profileDoc) => {
    const data = profileDoc.data() || {};
    const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.display_name || data.name || 'Unknown User';
    return [profileDoc.id, {
      id: profileDoc.id,
      name,
      email: data.email || data.contact_email || '',
      role: data.role || null,
    }];
  }));
};

const inferBookingType = (data = {}) => {
  const joined = [data.format, data.modality, data.listingTitle, data.title].filter(Boolean).join(' ').toLowerCase();
  return joined.includes('retreat') ? 'retreat' : 'session';
};

const summarizeBookingStatus = (status) => {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object') {
    if (status['booking-marked-as-complete-by-healer'] || status['booking-marked-as-complete-by-seeker']) return 'completed';
    if (status['booking-confirmed-by-healer']) return 'confirmed';
    if (status['invite-email-to-healer'] || status['invite-email-to-seeker']) return 'pending_confirmation';
    return 'created';
  }
  return 'unknown';
};

const mapBooking = (bookingDoc, participantMap) => {
  const d = bookingDoc.data() || {};
  const healer = participantMap.get(d.healerId) || null;
  const seeker = participantMap.get(d.seekerId) || null;
  const bookingType = inferBookingType(d);

  return {
    id: bookingDoc.id,
    bookingType,
    listingId: d.listingId || null,
    listingTitle: d.listingTitle || d.title || 'Untitled Service',
    healerId: d.healerId || null,
    healerName: d.healerName || healer?.name || 'Unknown Healer',
    healerEmail: d.healerEmail || healer?.email || '',
    seekerId: d.seekerId || null,
    seekerName: d.seekerName || seeker?.name || 'Unknown Seeker',
    seekerEmail: d.seekerEmail || seeker?.email || '',
    amount: toNumber(d.amount || d.totalAmount || d.paymentAmount || d.price, 0),
    currency: d.currency || 'USD',
    paymentStatus: d.paymentStatus || 'unknown',
    status: summarizeBookingStatus(d.status),
    sessionDate: toIsoOrNull(d.sessionDate || d.session_date || d.date),
    sessionTime: d.sessionTime || null,
    format: d.format || null,
    modality: d.modality || null,
    sessionLength: d.sessionLength || null,
    createdAt: toIsoOrNull(d.createdAt || d.created_at),
    updatedAt: toIsoOrNull(d.updatedAt || d.updated_at),
    rawStatus: d.status || null,
  };
};

const loadAllBookings = async () => {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');

  const participantMap = await buildParticipantMap(db);
  const bookingSnap = await getDocs(query(collection(db, BOOKINGS_COLLECTION), limit(500)));
  const results = bookingSnap.docs.map((bookingDoc) => mapBooking(bookingDoc, participantMap));
  return { db, participantMap, results };
};

const matchesSearch = (item, search) => {
  if (!search) return true;
  const haystack = [
    item.id,
    item.listingId,
    item.listingTitle,
    item.healerName,
    item.healerEmail,
    item.seekerName,
    item.seekerEmail,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  return haystack.some((value) => value.includes(search));
};

const listAdminBookings = async (req, res) => {
  try {
    const { results } = await loadAllBookings();
    const search = String(req.query.q || '').toLowerCase().trim();
    const requestedStatus = String(req.query.status || '').trim();
    const requestedType = String(req.query.type || '').trim();
    const requestedPaymentStatus = String(req.query.paymentStatus || '').trim();

    const filtered = results
      .filter((item) => matchesSearch(item, search))
      .filter((item) => !requestedStatus || item.status === requestedStatus)
      .filter((item) => !requestedType || item.bookingType === requestedType)
      .filter((item) => !requestedPaymentStatus || item.paymentStatus === requestedPaymentStatus)
      .sort((a, b) => String(b.sessionDate || b.createdAt || '').localeCompare(String(a.sessionDate || a.createdAt || '')));

    return res.json({
      success: true,
      results: filtered,
      filters: {
        q: req.query.q || '',
        status: requestedStatus || '',
        type: requestedType || '',
        paymentStatus: requestedPaymentStatus || '',
      },
    });
  } catch (error) {
    console.error('❌ Error listing admin bookings:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getSessionTranscript = async (db, bookingId) => {
  try {
    const sessionSnap = await getDoc(doc(db, SESSION_COLLECTION, bookingId));
    if (!sessionSnap.exists()) return [];
    const data = sessionSnap.data() || {};
    return Array.isArray(data.messages) ? data.messages : [];
  } catch (_error) {
    return [];
  }
};

const getRetreatRecord = async (db, listingId) => {
  if (!listingId) return null;
  try {
    const retreatSnap = await getDoc(doc(db, RETREAT_LISTINGS_COLLECTION, listingId));
    return retreatSnap.exists() ? retreatSnap.data() || null : null;
  } catch (_error) {
    return null;
  }
};

const getAdminBookingDetail = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const bookingSnap = await getDoc(doc(db, BOOKINGS_COLLECTION, id));
    if (!bookingSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const participantMap = await buildParticipantMap(db);
    const booking = mapBooking(bookingSnap, participantMap);
    const [transcript, retreatRecord] = await Promise.all([
      getSessionTranscript(db, id),
      booking.bookingType === 'retreat' ? getRetreatRecord(db, booking.listingId) : Promise.resolve(null),
    ]);

    return res.json({
      success: true,
      data: {
        ...booking,
        transcript,
        retreatRecord,
        rawBooking: bookingSnap.data() || {},
      },
    });
  } catch (error) {
    console.error('❌ Error getting admin booking detail:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateAdminBookingFlags = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const { status } = req.body || {};
    const bookingRef = doc(db, BOOKINGS_COLLECTION, id);
    const bookingSnap = await getDoc(bookingRef);
    if (!bookingSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const data = bookingSnap.data() || {};
    const currentStatus = typeof data.status === 'object' && data.status !== null ? data.status : {};
    let nextStatus = { ...currentStatus };

    switch (status) {
      case 'created':
        nextStatus = {
          'invite-email-to-seeker': false,
          'invite-email-to-healer': false,
          'booking-confirmed-by-healer': false,
          'booking-marked-as-complete-by-healer': false,
          'booking-marked-as-complete-by-seeker': false,
        };
        break;
      case 'pending_confirmation':
        nextStatus = {
          ...nextStatus,
          'invite-email-to-seeker': true,
          'invite-email-to-healer': true,
          'booking-confirmed-by-healer': false,
        };
        break;
      case 'confirmed':
        nextStatus = {
          ...nextStatus,
          'invite-email-to-seeker': true,
          'invite-email-to-healer': true,
          'booking-confirmed-by-healer': true,
        };
        break;
      case 'completed':
        nextStatus = {
          ...nextStatus,
          'invite-email-to-seeker': true,
          'invite-email-to-healer': true,
          'booking-confirmed-by-healer': true,
          'booking-marked-as-complete-by-healer': true,
          'booking-marked-as-complete-by-seeker': true,
        };
        break;
      default:
        return res.status(400).json({ success: false, error: 'Unsupported booking status override' });
    }

    const updatedAt = new Date().toISOString();
    await updateDoc(bookingRef, {
      status: nextStatus,
      updatedAt,
    });

    return res.json({
      success: true,
      data: {
        id,
        status,
        updatedAt,
      },
    });
  } catch (error) {
    console.error('❌ Error updating booking status flags:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  listAdminBookings,
  getAdminBookingDetail,
  updateAdminBookingFlags,
};
