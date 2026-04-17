const { initAdmin } = require('../config/firebaseAdmin');

let adminAuth;

try {
  const admin = initAdmin();
  adminAuth = admin.auth();
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin for seed script:', error.message);
  console.error('Supported options:');
  console.error('1. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY');
  console.error('2. Set GOOGLE_APPLICATION_CREDENTIALS to a service account file path');
  console.error('3. Keep using backend-server/serviceAccountKey.json if your env loader maps it into FIREBASE_* vars first');
  process.exit(1);
}

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
