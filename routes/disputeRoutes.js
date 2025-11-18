const express = require('express');
const {
  createDispute,
  getDispute,
  listDisputes,
  addEvidence,
  respond,
  decide,
  notifyEmail
} = require('../controllers/disputeController');

const router = express.Router();

// Create dispute
router.post('/disputes', createDispute);

// List disputes (filterable)
router.get('/disputes', listDisputes);

// Get single dispute
router.get('/disputes/:id', getDispute);

// Add evidence
router.post('/disputes/:id/evidence', addEvidence);

// Healer respond
router.post('/disputes/:id/respond', respond);

// Moderator decision
router.post('/disputes/:id/decision', decide);

// Trigger email notification webhook
router.post('/disputes/:id/notify-email', notifyEmail);

module.exports = router;