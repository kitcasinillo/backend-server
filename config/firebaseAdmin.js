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
    const privateKeyBase64 = process.env.FIREBASE_PRIVATE_KEY_BASE64;

    // Support base64-encoded private key as an alternative
    if (!privateKey && privateKeyBase64) {
      try {
        privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
      } catch (e) {
        throw new Error('Failed to decode FIREBASE_PRIVATE_KEY_BASE64');
      }
    }

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase Admin credentials are not set in environment variables');
    }

    // Normalize private key formatting from various env managers
    // 1) Replace escaped newlines
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    // 2) Normalize CRLF to LF
    privateKey = privateKey.replace(/\r\n/g, '\n');
    // 3) Strip surrounding quotes if present
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.slice(1, -1);
    }
    // 4) Ensure header/footer are intact
    if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
      throw new Error('Invalid FIREBASE_PRIVATE_KEY format: missing PEM header/footer');
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