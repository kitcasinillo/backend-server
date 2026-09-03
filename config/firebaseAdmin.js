const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let initialized = false;

const initAdmin = () => {
  if (initialized) return admin;

  try {
    // Method 1: Check for serviceAccountKey.json file in backend-server directory
    const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id || 'ultrahealers'}-default-rtdb.firebaseio.com`
      });
      initialized = true;
      console.log('✅ Firebase Admin SDK initialized using local serviceAccountKey.json');
      return admin;
    }

    // Method 2: Application Default Credentials
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      initialized = true;
      console.log('✅ Firebase Admin SDK initialized using GOOGLE_APPLICATION_CREDENTIALS');
      return admin;
    }

    // Method 3: Environment Variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const privateKeyBase64 = process.env.FIREBASE_PRIVATE_KEY_BASE64;

    if (!privateKey && privateKeyBase64) {
      try {
        privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
      } catch (e) {
        throw new Error('Failed to decode FIREBASE_PRIVATE_KEY_BASE64');
      }
    }

    if (projectId && clientEmail && privateKey) {
      // Normalize private key formatting
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }
      privateKey = privateKey.replace(/\r\n/g, '\n');
      if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
        privateKey = privateKey.slice(1, -1);
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      initialized = true;
      console.log('✅ Firebase Admin SDK initialized using environment variables (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)');
      return admin;
    }

    throw new Error('Firebase Admin credentials not found. Provide serviceAccountKey.json or set FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY.');
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error.message);
    throw error;
  }
};

module.exports = { initAdmin, admin };