const { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } = require('firebase/firestore');
const { getDatabase } = require('../config/database');

const PROFILES_COLLECTION = 'profiles';
const LISTINGS_COLLECTION = 'listings';
const RETREAT_LISTINGS_COLLECTION = 'retreat_listings';
const BOOKINGS_COLLECTION = 'bookings';

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
  const raw = String(value || '').toLowerCase().trim();
  if (['active', 'approved', 'published', 'live'].includes(raw)) return 'Active';
  if (['pending', 'review', 'in_review', 'draft'].includes(raw)) return 'Pending';
  if (['rejected', 'declined'].includes(raw)) return 'Rejected';
  if (['hidden', 'archived', 'inactive', 'disabled'].includes(raw)) return 'Hidden';
  return 'Pending';
};

const mapListingCategory = (data = {}, source = 'session') => {
  if (source === 'retreat') return 'Retreat';
  return data.category || data.modality || data.service_category || data.type || 'Session';
};

const mapListingTitle = (data = {}, source = 'session') => {
  if (source === 'retreat') return data.title || data.name || 'Untitled Retreat';
  return data.title || data.service_name || data.name || 'Untitled Listing';
};

const mapDescription = (data = {}) => data.description || data.summary || data.about || '';

const summarizeBookingStatus = (status) => {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object') {
    if (status['booking-marked-as-complete-by-healer'] || status['booking-marked-as-complete-by-seeker']) return 'completed';
    if (status['booking-confirmed-by-healer']) return 'confirmed';
    if (status['invite-email-to-healer'] || status['invite-email-to-seeker']) return 'pending_confirmation';
    if (status.state) return String(status.state);
    return 'created';
  }
  return status ? String(status) : 'unknown';
};

const buildListingListItem = (docSnap, healerMap, source = 'session') => {
  const d = docSnap.data() || {};
  const healerId = d.healerId || d.hostId || d.userId || d.ownerId || null;
  const healer = healerId ? healerMap.get(healerId) : null;
  const status = normalizeStatus(d.status);

  return {
    id: docSnap.id,
    source,
    title: mapListingTitle(d, source),
    healerId,
    healerName: healer?.name || d.healerName || d.hostName || 'Unknown Healer',
    category: mapListingCategory(d, source),
    price: toNumber(d.price?.amount || d.price || d.session_price || d.amount || d.cost, 0),
    currency: d.price?.currency || d.currency || 'USD',
    status,
    rating: toNumber(d.rating || d.average_rating, 0),
    createdAt: toIsoOrNull(d.created_at || d.createdAt || d.submitted_at),
    featured: d.featured === true,
    location: d.location || d.city || d.address || '',
    rawStatus: d.status || null,
  };
};

const loadHealerMap = async (db) => {
  const profileSnap = await getDocs(query(collection(db, PROFILES_COLLECTION), where('role', '==', 'healer'), limit(300)));
  return new Map(profileSnap.docs.map((profileDoc) => {
    const data = profileDoc.data() || {};
    const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.display_name || data.name || 'Unknown Healer';
    return [profileDoc.id, { id: profileDoc.id, name, email: data.email || data.contact_email || '' }];
  }));
};

const loadAllListings = async () => {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');

  const healerMap = await loadHealerMap(db);
  const [sessionSnap, retreatSnap] = await Promise.all([
    getDocs(query(collection(db, LISTINGS_COLLECTION), limit(300))),
    getDocs(query(collection(db, RETREAT_LISTINGS_COLLECTION), limit(300))),
  ]);

  const items = [
    ...sessionSnap.docs.map((docSnap) => buildListingListItem(docSnap, healerMap, 'session')),
    ...retreatSnap.docs.map((docSnap) => buildListingListItem(docSnap, healerMap, 'retreat')),
  ];

  return { db, healerMap, items };
};

const matchesSearch = (item, search) => {
  if (!search) return true;
  const haystack = [item.id, item.title, item.healerName, item.category, item.location]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return haystack.some((value) => value.includes(search));
};

const listAdminListings = async (req, res) => {
  try {
    const { items } = await loadAllListings();
    const search = String(req.query.q || '').toLowerCase().trim();
    const requestedStatus = String(req.query.status || '').trim();
    const requestedSource = String(req.query.source || '').trim();

    const results = items
      .filter((item) => matchesSearch(item, search))
      .filter((item) => !requestedStatus || item.status === requestedStatus)
      .filter((item) => !requestedSource || item.source === requestedSource)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return res.json({
      success: true,
      results,
      filters: {
        q: req.query.q || '',
        status: requestedStatus || '',
        source: requestedSource || '',
      },
    });
  } catch (error) {
    console.error('❌ Error listing admin listings:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const loadBookingsForListing = async (db, listingId) => {
  const snapshot = await getDocs(query(collection(db, BOOKINGS_COLLECTION), where('listingId', '==', listingId), limit(100)));
  return snapshot.docs.map((bookingDoc) => {
    const d = bookingDoc.data() || {};
    return {
      id: bookingDoc.id,
      amount: toNumber(d.amount || d.totalAmount || d.price || d.paymentAmount, 0),
      createdAt: toIsoOrNull(d.created_at || d.createdAt),
      sessionDate: toIsoOrNull(d.sessionDate || d.session_date || d.date),
      status: summarizeBookingStatus(d.status),
      seekerName: d.seekerName || null,
      healerName: d.healerName || null,
    };
  });
};

const getListingCollection = (source) => source === 'retreat' ? RETREAT_LISTINGS_COLLECTION : LISTINGS_COLLECTION;

const getAdminListingDetail = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const source = String(req.query.source || 'session').trim() === 'retreat' ? 'retreat' : 'session';
    const listingRef = doc(db, getListingCollection(source), id);
    const listingSnap = await getDoc(listingRef);

    if (!listingSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const healerMap = await loadHealerMap(db);
    const base = buildListingListItem(listingSnap, healerMap, source);
    const raw = listingSnap.data() || {};
    const healer = base.healerId ? healerMap.get(base.healerId) : null;
    const bookings = await loadBookingsForListing(db, id);
    const totalBookings = bookings.length;
    const totalRevenue = bookings.reduce((sum, booking) => sum + booking.amount, 0);
    const completedBookings = bookings.filter((booking) => String(booking.status).toLowerCase().includes('complete')).length;
    const completionRate = totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0;

    const result = {
      ...base,
      healerEmail: healer?.email || '',
      description: mapDescription(raw),
      durationMinutes: toNumber(raw.duration_minutes || raw.duration || raw.session_duration, 0),
      requiredInformation: Array.isArray(raw.required_information)
        ? raw.required_information
        : Array.isArray(raw.requiredInfo)
          ? raw.requiredInfo
          : [],
      images: Array.isArray(raw.images) ? raw.images : Array.isArray(raw.photos) ? raw.photos : [],
      featured: raw.featured === true,
      revisionHistory: Array.isArray(raw.revision_history) ? raw.revision_history : [],
      performance: {
        totalBookings,
        completionRate,
        totalRevenue,
      },
      recentBookings: bookings.sort((a, b) => String(b.sessionDate || b.createdAt || '').localeCompare(String(a.sessionDate || a.createdAt || ''))).slice(0, 20),
      rawListing: raw,
    };

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error getting admin listing detail:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateAdminListingStatus = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const source = String(req.query.source || req.body?.source || 'session').trim() === 'retreat' ? 'retreat' : 'session';
    const { status } = req.body || {};
    const allowed = ['Active', 'Pending', 'Rejected', 'Hidden'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${allowed.join(', ')}` });
    }

    const nextRawStatus = status.toLowerCase();
    const listingRef = doc(db, getListingCollection(source), id);
    const listingSnap = await getDoc(listingRef);
    if (!listingSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    const updatedAt = new Date().toISOString();
    await updateDoc(listingRef, {
      status: nextRawStatus,
      updated_at: updatedAt,
      admin_status_override: status,
    });

    return res.json({ success: true, data: { id, source, status, updatedAt } });
  } catch (error) {
    console.error('❌ Error updating admin listing status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  listAdminListings,
  getAdminListingDetail,
  updateAdminListingStatus,
};