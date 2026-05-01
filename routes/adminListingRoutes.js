const express = require('express');
const {
  listAdminListings,
  getAdminListingDetail,
  updateAdminListingStatus,
} = require('../controllers/adminListingsController');

const router = express.Router();

router.get('/listings', listAdminListings);
router.get('/listings/:id', getAdminListingDetail);
router.patch('/listings/:id/status', updateAdminListingStatus);

module.exports = router;
