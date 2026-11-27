const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { collection, getDocs, updateDoc } = require('firebase/firestore');
const { initializeFirebase, getDatabase } = require('../config/database');
const { getProfileRoles } = require('../utils/profileRoles');

const shouldApply = process.argv.includes('--apply');

async function run() {
  initializeFirebase();
  const db = getDatabase();
  if (!db) {
    console.error('❌ Database not initialized');
    process.exit(1);
  }

  console.log(`🔍 Scanning profiles collection (${shouldApply ? 'APPLY MODE' : 'DRY RUN'})...`);
  const snap = await getDocs(collection(db, 'profiles'));

  let total = 0;
  let needsUpdate = 0;
  let updated = 0;

  for (const docSnap of snap.docs) {
    total += 1;
    const data = docSnap.data() || {};
    const existingRoles = Array.isArray(data.roles)
      ? data.roles.map((r) => String(r).toLowerCase().trim()).filter(Boolean)
      : [];
    const normalizedRoles = getProfileRoles(data);

    if (normalizedRoles.length === 0) continue;

    const alreadySynced =
      Array.isArray(data.roles) &&
      existingRoles.length === normalizedRoles.length &&
      normalizedRoles.every((r) => existingRoles.includes(r));

    if (!alreadySynced) {
      needsUpdate += 1;
      console.log(`  • ${docSnap.id}: roles ${JSON.stringify(data.roles || null)} -> ${JSON.stringify(normalizedRoles)} (role=${data.role || 'none'})`);
      if (shouldApply) {
        await updateDoc(docSnap.ref, {
          roles: normalizedRoles,
          updated_at: new Date().toISOString(),
        });
        updated += 1;
      }
    }
  }

  console.log(`\n✅ Done. Scanned: ${total}, Needs update: ${needsUpdate}, Updated: ${updated}`);
  if (!shouldApply && needsUpdate > 0) {
    console.log('ℹ️  Re-run with --apply to write these changes to Firestore.');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
