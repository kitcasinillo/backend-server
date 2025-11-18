const { getDatabase } = require('../config/database');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const SETTINGS_COLLECTION = 'settings';
const SETTINGS_DOC = 'app_config';

// Default settings
const DEFAULT_SETTINGS = {
  listing_limit_free: 5,
  listing_limit_premium: 50,
  max_images_per_listing: 10,
  max_file_size_mb: 5,
  features: {
    free_tier: ['basic_listings', 'messaging', 'basic_analytics'],
    premium_tier: ['unlimited_listings', 'advanced_analytics', 'priority_support', 'custom_branding']
  },
  // New pricing configuration
  pricing: {
    free: { amount: 0, currency: 'USD' },
    premium: { amount: 120, currency: 'USD' }
  },
  created_at: new Date(),
  updated_at: new Date()
};

/**
 * Initialize default settings if they don't exist
 */
const initializeSettings = async () => {
  try {
    const db = getDatabase();
    if (!db) {
      console.error('❌ Firestore database not initialized');
      return DEFAULT_SETTINGS;
    }

    const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
    const settingsSnap = await getDoc(settingsRef);

    if (!settingsSnap.exists()) {
      console.log('📋 Settings not found. Creating default settings...');
      await setDoc(settingsRef, DEFAULT_SETTINGS);
      console.log('✅ Default settings created successfully');
      return DEFAULT_SETTINGS;
    }

    console.log('✅ Settings already exist');
    return settingsSnap.data();
  } catch (error) {
    console.error('❌ Error initializing settings:', error);
    throw error;
  }
};

/**
 * Get all settings
 */
const getSettings = async (_req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not initialized'
      });
    }

    const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
    const settingsSnap = await getDoc(settingsRef);

    if (!settingsSnap.exists()) {
      // Initialize if doesn't exist
      const defaultSettings = await initializeSettings();
      return res.json({
        success: true,
        data: defaultSettings,
        message: 'Default settings returned'
      });
    }

    res.json({
      success: true,
      data: settingsSnap.data()
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Update settings (admin only)
 */
const updateSettings = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not initialized'
      });
    }

    const { listing_limit_free, listing_limit_premium, max_images_per_listing, max_file_size_mb, features, pricing } = req.body;

    const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC);

    const updateData = {
      updated_at: new Date()
    };

    if (listing_limit_free !== undefined) updateData.listing_limit_free = listing_limit_free;
    if (listing_limit_premium !== undefined) updateData.listing_limit_premium = listing_limit_premium;
    if (max_images_per_listing !== undefined) updateData.max_images_per_listing = max_images_per_listing;
    if (max_file_size_mb !== undefined) updateData.max_file_size_mb = max_file_size_mb;
    if (features !== undefined) updateData.features = features;
    if (pricing !== undefined) updateData.pricing = pricing;

    await setDoc(settingsRef, updateData, { merge: true });

    const updatedSnap = await getDoc(settingsRef);

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedSnap.data()
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get listing limit for a healer based on their subscription
 */
const getHealerListingLimit = async (req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not initialized'
      });
    }

    const { healerId } = req.params;

    if (!healerId) {
      return res.status(400).json({
        success: false,
        error: 'Healer ID is required'
      });
    }

    // Get settings
    const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
    const settingsSnap = await getDoc(settingsRef);
    const settings = settingsSnap.exists() ? settingsSnap.data() : DEFAULT_SETTINGS;

    // Get healer profile to check subscription
    const healerRef = doc(db, 'profiles', healerId);
    const healerSnap = await getDoc(healerRef);

    if (!healerSnap.exists()) {
      return res.status(404).json({
        success: false,
        error: 'Healer not found'
      });
    }

  const healerData = healerSnap.data();
  const isPremium = healerData?.subscription_type === 'premium' || healerData?.is_premium === true;

  const premiumLimitRaw = Number(settings.listing_limit_premium);
  const freeLimitRaw = Number(settings.listing_limit_free);
  const hasPremiumPositiveLimit = Number.isFinite(premiumLimitRaw) && premiumLimitRaw > 0;
  const hasFreePositiveLimit = Number.isFinite(freeLimitRaw) && freeLimitRaw > 0;

  const limit = isPremium
    ? (hasPremiumPositiveLimit ? premiumLimitRaw : null)
    : (hasFreePositiveLimit ? freeLimitRaw : 5);

  const unlimited = isPremium
    ? !hasPremiumPositiveLimit // Premium is unlimited only when premium limit is not set or <= 0
    : false; // Free tier is never unlimited

  res.json({
    success: true,
    data: {
      healerId,
      listing_limit: limit,
      is_premium: isPremium,
      subscription_type: healerData?.subscription_type || 'free',
      unlimited
    }
  });
  } catch (error) {
    console.error('Error fetching healer listing limit:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reset settings to defaults
 */
const resetSettings = async (_req, res) => {
  try {
    const db = getDatabase();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not initialized'
      });
    }

    const settingsRef = doc(db, SETTINGS_COLLECTION, SETTINGS_DOC);
    await setDoc(settingsRef, DEFAULT_SETTINGS);

    res.json({
      success: true,
      message: 'Settings reset to defaults',
      data: DEFAULT_SETTINGS
    });
  } catch (error) {
    console.error('Error resetting settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  initializeSettings,
  getSettings,
  updateSettings,
  getHealerListingLimit,
  resetSettings
};

