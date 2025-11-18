// Seed modalities into Firestore
require('dotenv').config();
const { collection, doc, setDoc } = require('firebase/firestore');
const { initializeFirebase, getDatabase } = require('../config/database');
const modalities = require('../models/modalitiesSeedData');

async function run() {
  try {
    initializeFirebase();
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    const col = collection(db, 'modalities');
    const now = new Date().toISOString();

    for (const m of modalities) {
      const ref = doc(col, m.slug);
      await setDoc(ref, {
        slug: m.slug,
        label: m.label,
        synonyms: m.synonyms,
        active: true,
        created_at: now,
        updated_at: now,
      }, { merge: true });
      console.log(`✅ Seeded modality: ${m.label}`);
    }

    console.log('🎉 Modalities seeding complete');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  }
}

run();