const express = require('express');
const {
  listAdminRetreats,
  getAdminRetreatById,
  updateAdminRetreatStatus,
  approveAdminRetreat,
  deleteAdminRetreat,
} = require('../controllers/adminRetreatsController');

const router = express.Router();

router.get('/retreats', listAdminRetreats);
router.get('/retreats/:id', getAdminRetreatById);
router.patch('/retreats/:id/status', updateAdminRetreatStatus);
router.patch('/retreats/:id/approve', approveAdminRetreat);
router.delete('/retreats/:id', deleteAdminRetreat);

module.exports = router;
