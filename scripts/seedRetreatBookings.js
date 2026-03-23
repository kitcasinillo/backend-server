// Seed retreat bookings into Firestore
require('dotenv').config();
const { collection, addDoc, Timestamp, getDocs, deleteDoc, doc } = require('firebase/firestore');
const { initializeFirebase, getDatabase } = require('../config/database');

const dummyRetreatBookings = [
    {
        retreatTitle: "Spiritual Awakening in Ubud",
        healerName: "Master Wei",
        seekerName: "Alice Smith",
        seekerEmail: "alice@example.com",
        amount: 1200,
        currency: "USD",
        bookingDate: "2026-03-20",
        paymentStatus: "succeeded",
        createdAt: Timestamp.now()
    },
    {
        retreatTitle: "Yoga & Meditation Retreat",
        healerName: "Saraswati Devi",
        seekerName: "Bob Jones",
        seekerEmail: "bob@example.com",
        amount: 850,
        currency: "USD",
        bookingDate: "2026-03-21",
        paymentStatus: "pending",
        createdAt: Timestamp.now()
    },
    {
        retreatTitle: "Deep Forest Detox",
        healerName: "Forest Guardian",
        seekerName: "Charlie Brown",
        seekerEmail: "charlie@example.com",
        amount: 2500,
        currency: "USD",
        bookingDate: "2026-03-22",
        paymentStatus: "succeeded",
        createdAt: Timestamp.now()
    }
];

async function run() {
    try {
        initializeFirebase();
        const db = getDatabase();
        if (!db) {
            throw new Error('Database not initialized');
        }

        const col = collection(db, 'retreat_bookings');

        // Fresh Start: Delete existing retreat bookings
        console.log('🧹 Clearing existing retreat bookings...');
        const snapshot = await getDocs(col);
        for (const bookingDoc of snapshot.docs) {
            await deleteDoc(doc(db, 'retreat_bookings', bookingDoc.id));
        }
        console.log(`✅ Deleted ${snapshot.docs.length} old retreat bookings.`);

        for (const booking of dummyRetreatBookings) {
            await addDoc(col, {
                ...booking,
                updatedAt: Timestamp.now()
            });
            console.log(`✅ Seeded: ${booking.retreatTitle}`);
        }

        console.log('🎉 Retreat bookings seeding complete');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seeding failed:', err.message);
        process.exit(1);
    }
}

run();
