const admin = require('firebase-admin');

let initialized = false;

const initAdmin = () => {
  if (initialized) return admin;

  // Prefer Application Default Credentials if GOOGLE_APPLICATION_CREDENTIALS is set
  const hasAdc = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (hasAdc) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  } else {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase Admin credentials are not set in environment variables');
    }

    // Handle escaped newlines in env private key
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  initialized = true;
  return admin;
};

module.exports = { initAdmin, admin };