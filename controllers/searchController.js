const { getDatabase } = require('../config/database');
const { collection, getDocs, query, limit } = require('firebase/firestore');

// Map Firestore healer profile to search result shape expected by seeker app
const mapHealerToSearchResult = (doc) => {
  const d = doc.data();
  const firstName = d.first_name || '';
  const lastName = d.last_name || '';
  const name = `${firstName} ${lastName}`.trim() || d.display_name || 'Healer';
  return {
    id: doc.id,
    name,
    photo: d.profile_picture || d.avatar_url || 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=150&h=150&fit=crop&crop=face',
    modalities: Array.isArray(d.modalities) ? d.modalities : [],
    rating: d.rating || 4.5,
    price: (d.pricing && d.pricing.session) ? d.pricing.session : 120,
    currency: (d.pricing && d.pricing.currency) ? d.pricing.currency : 'USD',
    languages: Array.isArray(d.languages) ? d.languages : ['English'],
    gender: d.gender || 'N/A'
  };
};

const modalityLabelMap = {
  'reiki': ['reiki'],
  'acupuncture': ['acupuncture'],
  'massage': ['therapeutic massage', 'massage'],
  'craniosacral': ['craniosacral therapy', 'craniosacral'],
  'sound': ['sound healing', 'sound'],
  'crystal': ['crystal therapy', 'crystal healing', 'crystal'],
  'herbal': ['herbal medicine', 'herbal'],
  'meditation': ['meditation', 'mindfulness'],
  'hypnotherapy': ['hypnotherapy'],
  'psychotherapy': ['psychotherapy'],
  'yoga': ['yoga therapy', 'yoga'],
  'open-to-anything': ['any']
};

const normalizeModalities = (mods = []) => {
  if (!Array.isArray(mods)) return [];
  const expanded = [];
  for (const m of mods) {
    const mapped = modalityLabelMap[m] || [m];
    for (const val of mapped) {
      expanded.push(val);
    }
  }
  const lowered = expanded.map((x) => String(x).toLowerCase().trim());
  return Array.from(new Set(lowered));
};

// POST /api/healers/search
const searchHealers = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const params = req.body || {};
    const q = query(collection(db, 'profiles'), limit(150));
    const snapshot = await getDocs(q);

    const requestedMods = normalizeModalities(params.modalities || []);

    let filtered = snapshot.docs.filter((doc) => {
      try {
        const d = doc.data() || {};
        if (d.role && String(d.role).toLowerCase() !== 'healer') {
          return false;
        }
        if (!Array.isArray(params.modalities) || params.modalities.length === 0 || params.modalities.includes('open-to-anything')) {
          return true;
        }
        const profileMods = Array.isArray(d.modalities) ? d.modalities.map((m) => String(m).toLowerCase()) : [];
        const matchesAny = profileMods.some((pm) => requestedMods.some((rm) => pm.includes(rm)));
        return matchesAny;
      } catch (e) {
        console.warn('Skipping doc due to filter error:', e?.message || e);
        return false;
      }
    });

    if (filtered.length === 0) {
      filtered = snapshot.docs;
    }

    const results = filtered.map(mapHealerToSearchResult);
    results.sort((a, b) => (b.rating || 0) - (a.rating || 0));

    return res.json({ success: true, results });
  } catch (error) {
    console.error('❌ Error searching healers:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/healers/admin-search
const adminSearchHealers = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const search = String(req.query.q || '').toLowerCase().trim();
    const snapshot = await getDocs(query(collection(db, 'profiles'), limit(150)));

    const results = snapshot.docs
      .map((doc) => {
        const d = doc.data() || {};
        if (d.role && String(d.role).toLowerCase() !== 'healer') {
          return null;
        }

        const firstName = d.first_name || '';
        const lastName = d.last_name || '';
        const name = `${firstName} ${lastName}`.trim() || d.display_name || d.name || 'Healer';
        const email = d.email || d.contact_email || '';
        const rawStripeStatus = String(d.stripe_connect_status || (d.stripe_account_id ? 'active' : 'pending')).toLowerCase();
        const stripeStatus = rawStripeStatus === 'active' || rawStripeStatus === 'restricted' ? rawStripeStatus : 'pending';

        return {
          id: doc.id,
          name,
          email,
          stripeStatus,
          stripeAccountId: d.stripe_account_id || '',
        };
      })
      .filter(Boolean)
      .filter((item) => {
        if (!search) return true;
        return [item.name, item.email, item.id, item.stripeAccountId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({ success: true, results });
  } catch (error) {
    console.error('❌ Error admin-searching healers:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { searchHealers, adminSearchHealers };
