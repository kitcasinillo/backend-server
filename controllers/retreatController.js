const { getDatabase } = require('../config/database')
const { initAdmin, admin } = require('../config/firebaseAdmin')
const { collection, getDocs, query, where, doc, getDoc } = require('firebase/firestore')

// Collection name used by healer/seeker apps
const RETREAT_LISTINGS_COLLECTION = 'retreat_listings'

function mapListingToPublic(item) {
  // Map Firestore retreat listing to retreats-app model
  return {
    id: item.id,
    title: item.title,
    location: item.location,
    startDate: item.startDate,
    endDate: item.endDate,
    price: Number(item.pricePerPerson || item.price || 0),
    currency: item.currency || 'USD',
    imageUrl: item.coverImageUrl || (Array.isArray(item.images) && item.images[0]) || 'https://images.unsplash.com/photo-1519681393784-3cef4a71b1b4?q=80&w=1200&auto=format&fit=crop',
    shortDescription: item.description || item.shortDescription || '',
    longDescription: item.detailedDescription || item.longDescription || item.description || '',
    hostName: item.healerName || item.hostName || 'Hosted Retreat',
    hostEmail: item.contactEmail || item.hostEmail || '',
    capacity: Number(item.maxParticipants || item.capacity || 0)
  }
}

exports.getActiveRetreats = async (req, res) => {
  try {
    // Prefer Admin SDK if available (bypasses client security rules)
    let retreats = []
    try {
      const adm = initAdmin()
      const adminDb = adm.firestore()
      const snapshot = await adminDb
        .collection(RETREAT_LISTINGS_COLLECTION)
        .where('status', '==', 'active')
        .get()
      retreats = snapshot.docs.map(doc => mapListingToPublic({ id: doc.id, ...doc.data() }))
    } catch (adminErr) {
      // Fallback to client SDK
      const db = getDatabase()
      if (!db) {
        console.error('Firestore not initialized')
        return res.status(500).json({ success: false, error: 'Database not initialized' })
      }
      const listingsRef = collection(db, RETREAT_LISTINGS_COLLECTION)
      const q = query(listingsRef, where('status', '==', 'active'))
      const snapshot = await getDocs(q)
      retreats = snapshot.docs.map(doc => mapListingToPublic({ id: doc.id, ...doc.data() }))
    }

    res.json({ success: true, retreats })
  } catch (err) {
    console.error('Error fetching retreats:', err)
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch retreats' })
  }
}

exports.getRetreatById = async (req, res) => {
  try {
    const { id } = req.params
    let retreat
    try {
      const adm = initAdmin()
      const adminDb = adm.firestore()
      const docRef = adminDb.collection(RETREAT_LISTINGS_COLLECTION).doc(id)
      const docSnap = await docRef.get()
      if (!docSnap.exists) {
        return res.status(404).json({ success: false, error: 'Retreat not found' })
      }
      retreat = mapListingToPublic({ id: docSnap.id, ...docSnap.data() })
    } catch (adminErr) {
      const db = getDatabase()
      if (!db) {
        console.error('Firestore not initialized')
        return res.status(500).json({ success: false, error: 'Database not initialized' })
      }
      const docRef = doc(db, RETREAT_LISTINGS_COLLECTION, id)
      const docSnap = await getDoc(docRef)
      if (!docSnap.exists()) {
        return res.status(404).json({ success: false, error: 'Retreat not found' })
      }
      retreat = mapListingToPublic({ id: docSnap.id, ...docSnap.data() })
    }
    res.json({ success: true, retreat })
  } catch (err) {
    console.error('Error fetching retreat by id:', err)
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch retreat' })
  }
}