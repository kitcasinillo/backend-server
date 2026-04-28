const express = require('express');
const {
  listHealers,
  listSeekers,
  getHealerDetail,
  getSeekerDetail,
} = require('../controllers/adminUsersController');

const router = express.Router();

router.get('/users/healers', listHealers);
router.get('/users/healers/:id', getHealerDetail);
router.get('/users/seekers', listSeekers);
router.get('/users/seekers/:id', getSeekerDetail);

module.exports = router;
