const { collection, getDocs, getDoc, query, orderBy, limit, doc, setDoc } = require('firebase/firestore');
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

const createModality = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    const { name, icon } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const col = collection(db, 'modalities');
    const ref = doc(col, slug);

    const snapshot = await getDoc(ref);
    if (snapshot.exists()) {
      return res.status(400).json({ success: false, error: 'Modality already exists' });
    }

    const now = new Date().toISOString();
    const newModality = {
      slug,
      name,
      label: name,
      icon: icon || '✨',
      active: true,
      created_at: now,
      updated_at: now,
      listingsCount: 0,
      order: 999
    };

    await setDoc(ref, newModality);

    return res.status(201).json({ success: true, modality: { id: slug, ...newModality } });
  } catch (error) {
    console.error('Error creating modality:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getAllModalities,
  createModality,
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