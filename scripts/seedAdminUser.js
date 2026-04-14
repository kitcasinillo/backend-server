const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ serviceAccountKey.json not found at expected path:', serviceAccountPath);
  console.error('Please add the Firebase Admin service account JSON to backend-server/serviceAccountKey.json');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

initializeApp({
  credential: cert(serviceAccount),
});

const adminAuth = getAuth();

const adminEmail = process.env.ADMIN_SEED_EMAIL || 'ultrahealerz@gmail.com';
const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'uh2025#';
const adminDisplayName = process.env.ADMIN_SEED_NAME || 'UltraHealers Admin';

async function upsertAdminUser() {
  try {
    let userRecord;

    try {
      userRecord = await adminAuth.getUserByEmail(adminEmail);
      console.log(`✅ User already exists: ${adminEmail} (${userRecord.uid})`);
      await adminAuth.updateUser(userRecord.uid, {
        password: adminPassword,
        emailVerified: true,
        displayName: adminDisplayName,
      });
      console.log('🔄 Existing user updated with requested password/display name.');
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        userRecord = await adminAuth.createUser({
          email: adminEmail,
          password: adminPassword,
          emailVerified: true,
          displayName: adminDisplayName,
        });
        console.log(`✅ Created user: ${adminEmail} (${userRecord.uid})`);
      } else {
        throw error;
      }
    }

    await adminAuth.setCustomUserClaims(userRecord.uid, {
      admin: true,
      super_admin: true,
    });

    console.log('🔐 Applied custom claims: admin=true, super_admin=true');
    console.log(`✅ Admin seed complete for ${adminEmail}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to seed admin user:', error);
    process.exit(1);
  }
}

upsertAdminUser();
