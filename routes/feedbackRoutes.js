const express = require('express');
const {
  submitFeedback,
  listFeedback,
  getFeedbackSummary,
  updateFeedback,
  deleteFeedback,
  sendFeedbackPromptEmail,
} = require('../controllers/feedbackController');

const router = express.Router();

router.post('/', submitFeedback);
router.get('/summary', getFeedbackSummary);
router.get('/', listFeedback);
router.patch('/:id', updateFeedback);
router.delete('/:id', deleteFeedback);
router.post('/send-prompt', sendFeedbackPromptEmail);

module.exports = router;
