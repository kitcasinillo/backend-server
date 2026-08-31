// Seed bookings into Firestore
require('dotenv').config();
const { collection, addDoc, Timestamp } = require('firebase/firestore');
const { initializeFirebase, getDatabase } = require('../config/database');

const dummyBookings = [
    {
        listingTitle: "Deep Tissue Massage",
        healerName: "John Doe",
        seekerName: "Alice Smith",
        seekerEmail: "alice@example.com",
        amount: 85,
        currency: "USD",
        sessionDate: "2026-03-25",
        sessionTime: "10:00",
        paymentStatus: "succeeded",
        status: {
            'invite-email-to-seeker': true,
            'invite-email-to-healer': true,
            'booking-confirmed-by-healer': true,
            'booking-marked-as-complete-by-healer': false,
            'booking-marked-as-complete-by-seeker': false
        }
    },
    {
        listingTitle: "Yoga for Beginners",
        healerName: "Jane Roe",
        seekerName: "Bob Jones",
        seekerEmail: "bob@example.com",
        amount: 45,
        currency: "USD",
        sessionDate: "2026-03-26",
        sessionTime: "14:00",
        paymentStatus: "pending",
        status: {
            'invite-email-to-seeker': true,
            'invite-email-to-healer': false,
            'booking-confirmed-by-healer': false,
            'booking-marked-as-complete-by-healer': false,
            'booking-marked-as-complete-by-seeker': false
        }
    },
    {
        listingTitle: "Meditation Session",
        healerName: "Sarah Light",
        seekerName: "Charlie Brown",
        seekerEmail: "charlie@example.com",
        amount: 30,
        currency: "USD",
        sessionDate: "2026-03-27",
        sessionTime: "08:00",
        paymentStatus: "succeeded",
        status: {
            'invite-email-to-seeker': true,
            'invite-email-to-healer': true,
            'booking-confirmed-by-healer': true,
            'booking-marked-as-complete-by-healer': true,
            'booking-marked-as-complete-by-seeker': true
        }
    },
    {
        listingTitle: "Energy Planetarium",
        healerName: "Abhubakar Albaghdadi",
        seekerName: "Kennjay Lumahang",
        seekerEmail: "kennjaylumahang@gmail.com",
        amount: 99,
        currency: "USD",
        sessionDate: "2026-03-28",
        sessionTime: "13:30",
        paymentStatus: "succeeded",
        status: {
            'invite-email-to-seeker': true,
            'invite-email-to-healer': true,
            'booking-confirmed-by-healer': true,
            'booking-marked-as-complete-by-healer': false,
            'booking-marked-as-complete-by-seeker': false
        }
    },
    {
        listingTitle: "Reiki Healing",
        healerName: "Kent Remo",
        seekerName: "Danielle Dela Cruz",
        seekerEmail: "danielle@example.com",
        amount: 50,
        currency: "USD",
        sessionDate: "2026-03-29",
        sessionTime: "11:00",
        paymentStatus: "pending",
        status: {
            'invite-email-to-seeker': true,
            'invite-email-to-healer': true,
            'booking-confirmed-by-healer': false,
            'booking-marked-as-complete-by-healer': false,
            'booking-marked-as-complete-by-seeker': false
        }
    }
];

async function run() {
    try {
        initializeFirebase();
        const db = getDatabase();
        if (!db) {
            throw new Error('Database not initialized');
        }

        const col = collection(db, 'bookings');

        // Fresh Start: Delete existing bookings
        console.log('🧹 Clearing existing bookings...');
        const { getDocs, deleteDoc, doc } = require('firebase/firestore');
        const snapshot = await getDocs(col);
        for (const bookingDoc of snapshot.docs) {
            await deleteDoc(doc(db, 'bookings', bookingDoc.id));
        }
        console.log(`✅ Deleted ${snapshot.docs.length} old bookings.`);

        for (const booking of dummyBookings) {
            await addDoc(col, {
                ...booking,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            console.log(`✅ Seeded: ${booking.listingTitle}`);
        }

        console.log('🎉 Bookings seeding complete');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seeding failed:', err.message);
        process.exit(1);
    }
}

run();
