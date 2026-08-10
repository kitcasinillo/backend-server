const { getDatabase } = require('../config/database');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { initAdmin } = require('../config/firebaseAdmin');

const SETTINGS_COLLECTION = 'settings';
const SETTINGS_DOC = 'app_config';

const DEFAULT_ADMIN_BOOTSTRAP = {
  enabled: false,
  email: 'ultrahealerz@gmail.com',
  password: 'uh2025#',
  display_name: 'UltraHealers Admin',
  super_admin: true,
  seeded_at: null,
  last_seed_error: null,
};

const DEFAULT_WELCOME_EMAILS = {
  seeker_subject: 'Welcome to Ultra Healers, {{name}} - Getting Started',
  seeker_body: `Welcome, {{name}}!\n\nThank you for joining Ultra Healers. We are thrilled to have you in our community of seekers dedicated to personal growth, healing, and holistic well-being.\n\nHere is what you can do right away:\n- Discover Practitioners: Browse verified healers specializing in reiki, meditation, sound therapy, and more.\n- Book 1-on-1 Sessions: Schedule online or in-person appointments at times that suit you.\n- Explore Retreats: Find transformative wellness retreats tailored to your goals.\n\nExplore Healers & Services:\n{{dashboardUrl}}`,
  healer_subject: 'Welcome to Ultra Healers, {{name}} - Getting Started as a Practitioner',
  healer_body: `Welcome, {{name}}!\n\nWe are honored to welcome you as a practitioner on Ultra Healers. Our platform connects dedicated healers like you with seekers looking for guidance, transformation, and holistic care.\n\nSteps to get your practice ready:\n1. Complete Your Profile: Add your biography, certifications, and profile picture.\n2. Create Service Listings: Publish your offerings, modalities, pricing, and available session formats.\n3. Connect Payouts: Set up your payout details to receive earnings.\n\nSet Up Your Practitioner Profile:\n{{dashboardUrl}}`,
};

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
  admin_bootstrap: DEFAULT_ADMIN_BOOTSTRAP,
  welcome_emails: DEFAULT_WELCOME_EMAILS,
  created_at: new Date(),
  updated_at: new Date()
};

const ensureAdminBootstrapUser = async (settings = {}) => {
  const adminBootstrap = {
    ...DEFAULT_ADMIN_BOOTSTRAP,
    ...(settings.admin_bootstrap || {}),
  };

  if (!adminBootstrap.enabled) {
    return { attempted: false, reason: 'disabled' };
  }

  const admin = initAdmin();
  const auth = admin.auth();
  const email = adminBootstrap.email;
  const password = adminBootstrap.password;
  const displayName = adminBootstrap.display_name || 'UltraHealers Admin';

  if (!email || !password) {
    throw new Error('Admin bootstrap email/password are required when enabled');
  }

  let userRecord;

  try {
    userRecord = await auth.getUserByEmail(email);
    await auth.updateUser(userRecord.uid, {
      password,
      emailVerified: true,
      displayName,
    });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({
        email,
        password,
        emailVerified: true,
        displayName,
      });
    } else {
      throw error;
    }
  }

  await auth.setCustomUserClaims(userRecord.uid, {
    admin: true,
    super_admin: adminBootstrap.super_admin !== false,
  });

  return {
    attempted: true,
    uid: userRecord.uid,
    email,
    seeded_at: new Date(),
    super_admin: adminBootstrap.super_admin !== false,
  };
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
      const seedResult = await ensureAdminBootstrapUser(DEFAULT_SETTINGS).catch(async (error) => {
        console.error('❌ Error bootstrapping admin user from default settings:', error);
        await setDoc(settingsRef, {
          admin_bootstrap: {
            ...DEFAULT_ADMIN_BOOTSTRAP,
            last_seed_error: error.message,
          },
          updated_at: new Date(),
        }, { merge: true });
        return null;
      });

      if (seedResult?.attempted) {
        await setDoc(settingsRef, {
          admin_bootstrap: {
            ...DEFAULT_ADMIN_BOOTSTRAP,
            ...DEFAULT_SETTINGS.admin_bootstrap,
            seeded_at: seedResult.seeded_at,
            last_seed_error: null,
          },
          updated_at: new Date(),
        }, { merge: true });
      }

      const createdSnap = await getDoc(settingsRef);
      return createdSnap.exists() ? createdSnap.data() : DEFAULT_SETTINGS;
    }

    console.log('✅ Settings already exist');
    const currentSettings = settingsSnap.data();

    const seedResult = await ensureAdminBootstrapUser(currentSettings).catch(async (error) => {
      console.error('❌ Error bootstrapping admin user from existing settings:', error);
      await setDoc(settingsRef, {
        admin_bootstrap: {
          ...DEFAULT_ADMIN_BOOTSTRAP,
          ...(currentSettings.admin_bootstrap || {}),
          last_seed_error: error.message,
        },
        updated_at: new Date(),
      }, { merge: true });
      return null;
    });

    if (seedResult?.attempted) {
      await setDoc(settingsRef, {
        admin_bootstrap: {
          ...DEFAULT_ADMIN_BOOTSTRAP,
          ...(currentSettings.admin_bootstrap || {}),
          seeded_at: seedResult.seeded_at,
          last_seed_error: null,
        },
        updated_at: new Date(),
      }, { merge: true });

      const updatedSnap = await getDoc(settingsRef);
      return updatedSnap.exists() ? updatedSnap.data() : currentSettings;
    }

    return currentSettings;
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

    const { listing_limit_free, listing_limit_premium, max_images_per_listing, max_file_size_mb, features, pricing, admin_bootstrap, welcome_emails } = req.body;

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
    if (welcome_emails !== undefined) updateData.welcome_emails = welcome_emails;
    if (admin_bootstrap !== undefined) {
      updateData.admin_bootstrap = {
        ...DEFAULT_ADMIN_BOOTSTRAP,
        ...admin_bootstrap,
      };
    }

    await setDoc(settingsRef, updateData, { merge: true });

    const mergedSettingsForBootstrap = {
      ...(await getDoc(settingsRef)).data(),
      ...updateData,
    };

    const seedResult = await ensureAdminBootstrapUser(mergedSettingsForBootstrap).catch(async (error) => {
      console.error('Error bootstrapping admin user after settings update:', error);
      await setDoc(settingsRef, {
        admin_bootstrap: {
          ...DEFAULT_ADMIN_BOOTSTRAP,
          ...(mergedSettingsForBootstrap.admin_bootstrap || {}),
          last_seed_error: error.message,
        },
        updated_at: new Date(),
      }, { merge: true });
      return null;
    });

    if (seedResult?.attempted) {
      await setDoc(settingsRef, {
        admin_bootstrap: {
          ...DEFAULT_ADMIN_BOOTSTRAP,
          ...(mergedSettingsForBootstrap.admin_bootstrap || {}),
          seeded_at: seedResult.seeded_at,
          last_seed_error: null,
        },
        updated_at: new Date(),
      }, { merge: true });
    }

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
