const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { getDatabase } = require('firebase/database');

// Firebase initialization
let db = null;
let realtimeDb = null;

const initializeFirebase = () => {
  try {
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };

    if (!firebaseConfig.projectId) {
      console.error('❌ FIREBASE_PROJECT_ID is not set in environment variables');
      console.error('Please add your Firebase configuration to the .env file');
      return null;
    }

    // Add Realtime Database URL - use environment variable or generate from project ID
    firebaseConfig.databaseURL = process.env.FIREBASE_DATABASE_URL || 
      `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`;

    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    
    // Initialize Realtime Database
    try {
      realtimeDb = getDatabase(firebaseApp);
      console.log('✅ Firebase Realtime Database initialized successfully');
      console.log(`🔗 Database URL: ${firebaseConfig.databaseURL}`);
    } catch (dbError) {
      console.warn('⚠️ Failed to initialize Realtime Database:', dbError.message);
      console.warn('   This might be because Realtime Database is not enabled for this project');
      console.warn('   Enable it in Firebase Console: https://console.firebase.google.com/');
    }
    
    console.log('✅ Firebase initialized successfully');
    console.log(`🔑 Firebase project: ${firebaseConfig.projectId}`);
    return db;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    console.error('Please check your Firebase configuration');
    return null;
  }
};

const getFirestoreDB = () => db;
const getRealtimeDatabase = () => realtimeDb;

module.exports = {
  initializeFirebase,
  getDatabase: getFirestoreDB,
  getRealtimeDatabase,
  realtimeDb
};
