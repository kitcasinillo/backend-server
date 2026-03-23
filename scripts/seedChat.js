require('dotenv').config();
const { ref, set, push, serverTimestamp } = require('firebase/database');
const { initializeFirebase, getRealtimeDatabase, getDatabase } = require('../config/database');
const { collection, getDocs, query, limit } = require('firebase/firestore');

async function seedChat() {
    try {
        console.log('🚀 Starting chat seeder...');
        initializeFirebase();
        const rtdb = getRealtimeDatabase();
        const firestore = getDatabase();

        if (!rtdb || !firestore) {
            throw new Error('Databases not initialized. Check your .env file.');
        }

        // Get the latest seeded bookings from Firestore to link chats
        const bookingsCol = collection(firestore, 'bookings');
        const q = query(bookingsCol, limit(5));
        const bookingDocs = await getDocs(q);

        if (bookingDocs.empty) {
            console.log('⚠️ No bookings found in Firestore. Please run seedBookings.js first.');
            process.exit(1);
        }

        for (const doc of bookingDocs.docs) {
            const bookingId = doc.id;
            const booking = doc.data();
            
            console.log(`💬 Seeding chat for booking: ${bookingId} (${booking.listingTitle})`);

            const chatRef = ref(rtdb, `chats/${bookingId}`);
            
            // Create a few messages
            const messages = [
                {
                    text: "Hello! I'm looking forward to our session.",
                    senderId: booking.seekerId || 'seeker_123',
                    senderName: booking.seekerName,
                    timestamp: Date.now() - 1000000,
                    type: 'text'
                },
                {
                    text: "Hi Alice, I am too. Do you have any specific focus for today?",
                    senderId: booking.healerId || 'healer_123',
                    senderName: booking.healerName,
                    timestamp: Date.now() - 500000,
                    type: 'text'
                },
                {
                    text: "I'd like to focus on my lower back today if possible.",
                    senderId: booking.seekerId || 'seeker_123',
                    senderName: booking.seekerName,
                    timestamp: Date.now() - 100000,
                    type: 'text'
                }
            ];

            // Push messages to the list
            const messagesRef = ref(rtdb, `chats/${bookingId}/messages`);
            await set(messagesRef, null); // Clear existing

            for (const msg of messages) {
                const newMsgRef = push(messagesRef);
                await set(newMsgRef, msg);
            }

            // Update chat metadata
            await set(ref(rtdb, `chats/${bookingId}/metadata`), {
                lastMessage: messages[messages.length - 1].text,
                lastTimestamp: serverTimestamp(),
                bookingId: bookingId,
                participants: {
                    seeker: booking.seekerName,
                    healer: booking.healerName
                }
            });
        }

        console.log('🎉 Chat seeding complete!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Chat seeding failed:', err.message);
        process.exit(1);
    }
}

seedChat();
