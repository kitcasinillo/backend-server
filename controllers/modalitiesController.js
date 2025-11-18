const { collection, getDocs, query, orderBy, limit, doc, setDoc } = require('firebase/firestore');
const { getDatabase } = require('../config/database');
const seedModalities = require('../models/modalitiesSeedData');

// GET /api/modalities
const getAllModalities = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const q = query(collection(db, 'modalities'), orderBy('label'));
    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    return res.json({ success: true, modalities: items });
  } catch (error) {
    console.error('Error fetching modalities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getAllModalities,
  initializeModalitiesIfEmpty: async () => {
    try {
      const db = getDatabase();
      if (!db) {
        console.warn('Modalities init skipped: Database not initialized');
        return;
      }

      const snapshot = await getDocs(query(collection(db, 'modalities'), limit(1)));
      if (!snapshot.empty) {
        console.log('✅ Modalities collection already seeded. Skipping init.');
        return;
      }

      console.log('⚙️  Modalities collection empty. Seeding default modalities...');
      const col = collection(db, 'modalities');
      const now = new Date().toISOString();
      for (const m of seedModalities) {
        const ref = doc(col, m.slug);
        await setDoc(ref, {
          slug: m.slug,
          label: m.label,
          synonyms: m.synonyms,
          active: true,
          created_at: now,
          updated_at: now,
        }, { merge: true });
      }
      console.log('🎉 Modalities startup seeding complete');
    } catch (error) {
      console.error('Error initializing modalities:', error);
    }
  },
};