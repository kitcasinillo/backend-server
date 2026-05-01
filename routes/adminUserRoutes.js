const express = require('express');
const {
  listHealers,
  listSeekers,
  getHealerDetail,
  getSeekerDetail,
  updateUserSuspension,
} = require('../controllers/adminUsersController');

const router = express.Router();

router.get('/users/healers', listHealers);
router.get('/users/healers/:id', getHealerDetail);
router.patch('/users/healers/:id/suspension', updateUserSuspension);
router.get('/users/seekers', listSeekers);
router.get('/users/seekers/:id', getSeekerDetail);
router.patch('/users/seekers/:id/suspension', updateUserSuspension);

module.exports = router;
