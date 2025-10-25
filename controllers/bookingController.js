const { getDatabase } = require('../config/database');
const { getEmailTransporter } = require('../config/email');
const { generateHealerEmail, generateSeekerEmail } = require('../utils/emailTemplates');
const { collection, addDoc, query, where, getDocs } = require('firebase/firestore');

// In-memory cache for request deduplication
const pendingRequests = new Map();

// Create booking
const createBooking = async (req, res) => {
  let paymentIntentId = null;
  
  try {
    const {
      listingId,
      healerId,
      seekerId,
      listingTitle,
      healerName,
      seekerName,
      healerEmail,
      seekerEmail,
      amount,
      currency,
      sessionLength,
      format,
      modality,
      paymentIntentId: reqPaymentIntentId,
      paymentStatus,
      sessionDate,
      sessionTime,
      status
    } = req.body;
    
    paymentIntentId = reqPaymentIntentId;

    // Validate required fields
    if (!listingId || !healerId || !seekerId || !paymentIntentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: listingId, healerId, seekerId, paymentIntentId'
      });
    }

    // Validate email fields
    if (!healerEmail || !seekerEmail) {
      return res.status(400).json({
        success: false,
        error: 'Missing required email fields: healerEmail, seekerEmail'
      });
    }

    // Check for duplicate requests
    if (pendingRequests.has(paymentIntentId)) {
      console.log('🔄 Duplicate request detected for paymentIntentId:', paymentIntentId);
      return res.status(409).json({
        success: false,
        error: 'Request already in progress for this payment'
      });
    }

    // Mark this request as pending
    pendingRequests.set(paymentIntentId, true);

    console.log('📝 Creating booking with data:', {
      listingId,
      healerId,
      seekerId,
      paymentIntentId,
      amount
    });

    // Check for existing booking with same paymentIntentId
    let existingBooking = null;
    const db = getDatabase();
    if (db) {
      try {
        const bookingsRef = collection(db, 'bookings');
        const q = query(bookingsRef, where('paymentIntentId', '==', paymentIntentId));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          existingBooking = querySnapshot.docs[0].data();
          const existingBookingId = querySnapshot.docs[0].id;
          console.log('⚠️ Found existing booking with same paymentIntentId:', existingBookingId);
          console.log('📋 Existing booking data:', existingBooking);
          
          return res.json({
            success: true,
            bookingId: existingBookingId,
            data: { ...existingBooking, id: existingBookingId },
            message: 'Booking already exists for this payment'
          });
        }
      } catch (firestoreError) {
        console.error('❌ Error checking for existing booking:', firestoreError);
        // Continue with booking creation if check fails
      }
    } else {
      console.warn('⚠️ Firebase not initialized, skipping duplicate check');
    }

    // Create booking data with new status structure
    const bookingData = {
      listingId,
      healerId,
      seekerId,
      listingTitle: listingTitle || 'Untitled Service',
      healerName: healerName || 'Unknown Healer',
      seekerName: seekerName || 'Unknown User',
      healerEmail,
      seekerEmail,
      amount: amount || 0,
      currency: currency || 'USD',
      sessionLength: sessionLength || '60 min',
      format: format || 'Remote',
      modality: modality || 'Healing',
      paymentIntentId,
      paymentStatus: paymentStatus || 'succeeded',
      sessionDate: sessionDate || null,
      sessionTime: sessionTime || null,
      // New status structure with individual flags
      status: {
        'invite-email-to-seeker': false,
        'invite-email-to-healer': false,
        'booking-confirmed-by-healer': false,
        'booking-marked-as-complete-by-healer': false,
        'booking-marked-as-complete-by-seeker': false
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save booking to Firestore
    let bookingId = null;
    if (db) {
      try {
        const bookingRef = await addDoc(collection(db, 'bookings'), bookingData);
        bookingId = bookingRef.id;
        console.log('✅ Booking saved to Firestore with ID:', bookingId);
      } catch (firestoreError) {
        console.error('❌ Error saving booking to Firestore:', firestoreError);
        // Fallback to generating a temporary ID
        bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log('⚠️ Using temporary booking ID:', bookingId);
      }
    } else {
      // Fallback if Firebase is not initialized
      bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log('⚠️ Firebase not initialized, using temporary booking ID:', bookingId);
    }

    // Send emails and update status
    const emailTransporter = getEmailTransporter();
    if (emailTransporter) {
      try {
        // Prepare email data with all booking details
        const emailData = {
          bookingId,
          healerName,
          seekerName,
          seekerEmail,
          listingTitle,
          amount,
          sessionDate: sessionDate || null,
          sessionTime: sessionTime || null,
          sessionLength: sessionLength || '60 min',
          format: format || 'Remote',
          modality: modality || 'Healing'
        };

        // Email to healer
        await emailTransporter.sendMail({
          from: process.env.EMAIL_USER,
          to: healerEmail,
          subject: '🎉 New Booking Confirmed - Ultra Healers',
          html: generateHealerEmail(emailData)
        });

        console.log(`✅ Healer email sent to ${healerEmail}`);

        // Email to seeker
        await emailTransporter.sendMail({
          from: process.env.EMAIL_USER,
          to: seekerEmail,
          subject: '✅ Your Booking is Confirmed - Ultra Healers',
          html: generateSeekerEmail(emailData)
        });

        console.log(`✅ Seeker email sent to ${seekerEmail}`);

        // Update status flags after successful email sending
        bookingData.status['invite-email-to-healer'] = true;
        bookingData.status['invite-email-to-seeker'] = true;

        console.log('✅ All emails sent successfully and status updated');
      } catch (emailError) {
        console.error('❌ Error sending emails:', emailError);
        // Don't fail the booking creation if emails fail
      }
    }

    res.json({
      success: true,
      bookingId,
      data: { ...bookingData, id: bookingId }
    });

  } catch (error) {
    console.error('❌ Error creating booking:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    // Clean up pending request
    if (paymentIntentId) {
      pendingRequests.delete(paymentIntentId);
    }
  }
};

// Send chat message
const sendChatMessage = async (req, res) => {
  try {
    const { bookingId, message, senderId, senderName } = req.body;

    // Validate required fields
    if (!bookingId || !message || !senderId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: bookingId, message, senderId'
      });
    }

    console.log('💬 Sending chat message for booking:', bookingId);

    // Chat messages are handled by Firebase Realtime Database
    // This endpoint is a placeholder for any additional processing needed
    res.json({
      success: true,
      message: 'Chat message sent successfully'
    });

  } catch (error) {
    console.error('❌ Error sending chat message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  createBooking,
  sendChatMessage
};
