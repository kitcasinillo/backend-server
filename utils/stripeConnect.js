const { doc, getDoc, updateDoc } = require('firebase/firestore');
const { getDatabase } = require('../config/database');
const { getStripe } = require('../config/stripe');

// Helper function to check if healer has Stripe Connect account
async function getHealerStripeAccount(healerId) {
  try {
    const db = getDatabase();
    if (!db) {
      console.warn('⚠️ Firebase not initialized, cannot check healer Stripe account');
      return null;
    }
    
    const profileRef = doc(db, 'profiles', healerId);
    const profileDoc = await getDoc(profileRef);
    
    if (profileDoc.exists()) {
      const profileData = profileDoc.data();
      return profileData.stripe_account_id || null;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error checking healer Stripe account:', error);
    return null;
  }
}

// Helper function to create Stripe Connect account for healer
async function createHealerStripeAccount(healerId, healerEmail, healerName) {
  try {
    const stripe = getStripe();
    if (!stripe) {
      throw new Error('Stripe not initialized');
    }
    
    // Create Stripe Connect account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US', // You can make this dynamic based on healer's location
      email: healerEmail,
      business_type: 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_profile: {
        name: healerName || 'Ultra Healers Practitioner',
        url: 'https://ultrahealers.com'
      }
    });
    
    // Save Stripe account ID to healer's profile
    const db = getDatabase();
    if (db) {
      const profileRef = doc(db, 'profiles', healerId);
      await updateDoc(profileRef, {
        stripe_account_id: account.id,
        updated_at: new Date().toISOString()
      });
    }
    
    console.log(`✅ Created Stripe Connect account for healer ${healerId}: ${account.id}`);
    return account.id;
  } catch (error) {
    console.error('❌ Error creating Stripe Connect account:', error);
    throw error;
  }
}

module.exports = {
  getHealerStripeAccount,
  createHealerStripeAccount
};
