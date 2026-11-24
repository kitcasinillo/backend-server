const express = require('express');
const {
  listHealers,
  listSeekers,
  getHealerDetail,
  getSeekerDetail,
  updateUserSuspension,
  updateUserSoftDelete,
  updateUserVerification,
  permanentDeleteUser,
  listAuthUsers,
} = require('../controllers/adminUsersController');

const router = express.Router();

router.get('/users/auth-list', listAuthUsers);
router.get('/users/healers', listHealers);
router.get('/users/healers/:id', getHealerDetail);
router.patch('/users/healers/:id/suspension', updateUserSuspension('healer'));
router.patch('/users/healers/:id/soft-delete', updateUserSoftDelete('healer'));
router.patch('/users/healers/:id/verification', updateUserVerification('healer'));
router.delete('/users/healers/:id/permanent', permanentDeleteUser('healer'));
router.get('/users/seekers', listSeekers);
router.get('/users/seekers/:id', getSeekerDetail);
router.patch('/users/seekers/:id/suspension', updateUserSuspension('seeker'));
router.patch('/users/seekers/:id/soft-delete', updateUserSoftDelete('seeker'));
router.patch('/users/seekers/:id/verification', updateUserVerification('seeker'));
router.delete('/users/seekers/:id/permanent', permanentDeleteUser('seeker'));

module.exports = router;
