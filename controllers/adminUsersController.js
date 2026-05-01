const { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } = require('firebase/firestore');
const { getDatabase } = require('../config/database');

const PROFILES_COLLECTION = 'profiles';
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

const fullNameFromProfile = (data = {}, fallback = 'Unknown User') => {
  const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
  return fullName || data.display_name || data.name || fallback;
};

const userStatusFromProfile = (data = {}) => {
  const explicit = String(data.status || data.account_status || '').toLowerCase();
  if (explicit === 'suspended' || explicit === 'blocked' || explicit === 'inactive') return 'Suspended';
  if (explicit === 'pending') return 'Pending';
  if (data.is_suspended === true || data.suspended === true || data.disabled === true || data.is_disabled === true) return 'Suspended';
  return 'Active';
};

const mapHealerListItem = (profileDoc) => {
  const d = profileDoc.data() || {};
  const subscription = d.subscription_type === 'premium' || d.is_premium === true ? 'Premium' : 'Free';

  return {
    id: profileDoc.id,
    name: fullNameFromProfile(d, 'Healer'),
    email: d.email || d.contact_email || '',
    subscription,
    status: userStatusFromProfile(d),
    totalEarned: toNumber(d.total_earned || d.earnings_total || d.totalEarnings || d.total_income, 0),
    joinedDate: toIsoOrNull(d.created_at || d.createdAt || d.joined_at) || null,
    avatarUrl: d.profile_picture || d.avatar_url || d.photo_url || '',
    location: d.location || d.city || d.address || '',
    rating: toNumber(d.rating, 0),
    reviewCount: toNumber(d.review_count || d.reviews_count || d.total_reviews, 0),
  };
};

const mapSeekerListItem = (profileDoc) => {
  const d = profileDoc.data() || {};

  return {
    id: profileDoc.id,
    name: fullNameFromProfile(d, 'Seeker'),
    email: d.email || d.contact_email || '',
    status: userStatusFromProfile(d),
    totalSpent: toNumber(d.total_spent || d.lifetime_spend || d.totalSpent, 0),
    joinedDate: toIsoOrNull(d.created_at || d.createdAt || d.joined_at) || null,
    avatarUrl: d.profile_picture || d.avatar_url || d.photo_url || '',
    location: d.location || d.city || d.address || '',
  };
};

const buildBookingSummary = (bookingDoc) => {
  const d = bookingDoc.data() || {};
  return {
    id: bookingDoc.id,
    listingId: d.listingId || null,
    title: d.title || d.listingTitle || d.serviceName || d.sessionType || 'Booking',
    status: d.status?.state || d.status || 'unknown',
    amount: toNumber(d.amount || d.totalAmount || d.price || d.paymentAmount, 0),
    currency: d.currency || 'USD',
    sessionDate: toIsoOrNull(d.sessionDate || d.session_date || d.date),
    createdAt: toIsoOrNull(d.created_at || d.createdAt),
    healerId: d.healerId || null,
    healerName: d.healerName || null,
    seekerId: d.seekerId || null,
    seekerName: d.seekerName || null,
  };
};

const listProfilesByRole = async (role) => {
  const db = getDatabase();
  if (!db) throw new Error('Database not initialized');

  const snapshot = await getDocs(query(collection(db, PROFILES_COLLECTION), where('role', '==', role), limit(250)));
  return snapshot.docs;
};

const matchesSearch = (item, search) => {
  if (!search) return true;
  const haystack = [item.id, item.name, item.email, item.location, item.stripeAccountId]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return haystack.some((value) => value.includes(search));
};

const listHealers = async (req, res) => {
  try {
    const docs = await listProfilesByRole('healer');
    const search = String(req.query.q || '').toLowerCase().trim();
    const requestedStatus = String(req.query.status || '').trim();
    const requestedSubscription = String(req.query.subscription || '').trim();

    const results = docs
      .map(mapHealerListItem)
      .filter((item) => matchesSearch(item, search))
      .filter((item) => !requestedStatus || item.status === requestedStatus)
      .filter((item) => !requestedSubscription || item.subscription === requestedSubscription)
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      results,
      filters: {
        q: req.query.q || '',
        status: requestedStatus || '',
        subscription: requestedSubscription || '',
      },
    });
  } catch (error) {
    console.error('❌ Error listing healers for admin:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const listSeekers = async (req, res) => {
  try {
    const docs = await listProfilesByRole('seeker');
    const search = String(req.query.q || '').toLowerCase().trim();
    const requestedStatus = String(req.query.status || '').trim();

    const results = docs
      .map(mapSeekerListItem)
      .filter((item) => matchesSearch(item, search))
      .filter((item) => !requestedStatus || item.status === requestedStatus)
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      results,
      filters: {
        q: req.query.q || '',
        status: requestedStatus || '',
      },
    });
  } catch (error) {
    console.error('❌ Error listing seekers for admin:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getHealerDetail = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const profileSnap = await getDoc(doc(db, PROFILES_COLLECTION, id));
    if (!profileSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Healer not found' });
    }

    const profile = profileSnap.data() || {};
    const bookingSnap = await getDocs(query(collection(db, BOOKINGS_COLLECTION), where('healerId', '==', id), limit(20)));
    const bookings = bookingSnap.docs.map(buildBookingSummary).sort((a, b) => String(b.sessionDate || b.createdAt || '').localeCompare(String(a.sessionDate || a.createdAt || '')));

    const result = {
      id,
      role: 'healer',
      name: fullNameFromProfile(profile, 'Healer'),
      email: profile.email || profile.contact_email || '',
      status: userStatusFromProfile(profile),
      subscription: profile.subscription_type === 'premium' || profile.is_premium === true ? 'Premium' : 'Free',
      totalEarned: toNumber(profile.total_earned || profile.earnings_total || profile.totalEarnings || profile.total_income, 0),
      pendingPayout: toNumber(profile.pending_payout || profile.pendingPayout || profile.pending_balance, 0),
      avatarUrl: profile.profile_picture || profile.avatar_url || profile.photo_url || '',
      location: profile.location || profile.city || profile.address || '',
      joinedDate: toIsoOrNull(profile.created_at || profile.createdAt || profile.joined_at),
      bio: profile.bio || profile.about || '',
      modalities: Array.isArray(profile.modalities) ? profile.modalities : [],
      rating: toNumber(profile.rating, 0),
      reviewCount: toNumber(profile.review_count || profile.reviews_count || profile.total_reviews, 0),
      languages: Array.isArray(profile.languages) ? profile.languages : [],
      stripeAccountId: profile.stripe_account_id || '',
      stripeStatus: profile.stripe_connect_status || (profile.stripe_account_id ? 'active' : 'not_connected'),
      rawProfile: profile,
      recentBookings: bookings,
    };

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error getting healer detail for admin:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getSeekerDetail = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const profileSnap = await getDoc(doc(db, PROFILES_COLLECTION, id));
    if (!profileSnap.exists()) {
      return res.status(404).json({ success: false, error: 'Seeker not found' });
    }

    const profile = profileSnap.data() || {};
    const bookingSnap = await getDocs(query(collection(db, BOOKINGS_COLLECTION), where('seekerId', '==', id), limit(20)));
    const bookings = bookingSnap.docs.map(buildBookingSummary).sort((a, b) => String(b.sessionDate || b.createdAt || '').localeCompare(String(a.sessionDate || a.createdAt || '')));

    const totalSpentFromBookings = bookings.reduce((sum, booking) => sum + toNumber(booking.amount, 0), 0);

    const result = {
      id,
      role: 'seeker',
      name: fullNameFromProfile(profile, 'Seeker'),
      email: profile.email || profile.contact_email || '',
      status: userStatusFromProfile(profile),
      totalSpent: toNumber(profile.total_spent || profile.lifetime_spend || profile.totalSpent, totalSpentFromBookings),
      sessionsBooked: bookings.length,
      retreatsAttended: toNumber(profile.retreats_attended || profile.retreatsAttended, 0),
      avatarUrl: profile.profile_picture || profile.avatar_url || profile.photo_url || '',
      location: profile.location || profile.city || profile.address || '',
      joinedDate: toIsoOrNull(profile.created_at || profile.createdAt || profile.joined_at),
      bio: profile.bio || profile.about || '',
      rawProfile: profile,
      recentBookings: bookings,
    };

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error getting seeker detail for admin:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateUserSuspension = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) return res.status(500).json({ success: false, error: 'Database not initialized' });

    const { id } = req.params;
    const { suspended, reason = null } = req.body || {};

    if (typeof suspended !== 'boolean') {
      return res.status(400).json({ success: false, error: 'suspended boolean is required' });
    }

    const profileRef = doc(db, PROFILES_COLLECTION, id);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const previous = profileSnap.data() || {};
    const nextStatus = suspended ? 'suspended' : 'active';
    const updatedAt = new Date().toISOString();

    await updateDoc(profileRef, {
      status: nextStatus,
      account_status: nextStatus,
      suspended,
      is_suspended: suspended,
      suspension_reason: suspended ? reason : null,
      suspended_at: suspended ? updatedAt : null,
      unsuspended_at: suspended ? null : updatedAt,
      updated_at: updatedAt,
    });

    return res.json({
      success: true,
      data: {
        id,
        previousStatus: userStatusFromProfile(previous),
        status: suspended ? 'Suspended' : 'Active',
        suspended,
        reason: suspended ? reason : null,
        updatedAt,
      },
    });
  } catch (error) {
    console.error('❌ Error updating admin user suspension:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  listHealers,
  listSeekers,
  getHealerDetail,
  getSeekerDetail,
  updateUserSuspension,
};
