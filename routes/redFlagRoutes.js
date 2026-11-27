const express = require('express');
const {
  scanAndFlagMessage,
  listRedFlags,
  getRedFlagsSummary,
  updateRedFlag,
  deleteRedFlag,
} = require('../controllers/redFlagController');

const router = express.Router();

router.post('/red-flags/scan', scanAndFlagMessage);
router.get('/red-flags/summary', getRedFlagsSummary);
router.get('/red-flags', listRedFlags);
router.patch('/red-flags/:id', updateRedFlag);
router.delete('/red-flags/:id', deleteRedFlag);

module.exports = router;
