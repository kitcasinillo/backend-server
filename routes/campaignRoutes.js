const express = require('express');
const {
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  previewAudience,
  searchCampaignUsers,
  sendCampaignNow,
  sendCampaignTestEmail,
  trackCampaignOpen,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listUnsubscribes,
  resubscribeUser,
  processUnsubscribe,
  uploadCampaignImage,
} = require('../controllers/campaignController');

const router = express.Router();

// Public campaign endpoints (tracking pixel & one-click unsubscribe)
router.get('/campaigns/track/open/:id', trackCampaignOpen);
router.post('/campaigns/unsubscribe', processUnsubscribe);

// Admin templates endpoints (must come before /admin/campaigns/:id)
router.get('/admin/campaigns/templates', listTemplates);
router.post('/admin/campaigns/templates', createTemplate);
router.put('/admin/campaigns/templates/:id', updateTemplate);
router.delete('/admin/campaigns/templates/:id', deleteTemplate);

// Admin unsubscribes endpoints (must come before /admin/campaigns/:id)
router.get('/admin/campaigns/unsubscribes', listUnsubscribes);
router.delete('/admin/campaigns/unsubscribes/:id', resubscribeUser);

// Admin audience preview, user search & image upload
router.post('/admin/campaigns/audience-preview', previewAudience);
router.get('/admin/campaigns/users/search', searchCampaignUsers);
router.post('/admin/campaigns/upload-image', uploadCampaignImage);

// Admin campaigns CRUD & sending
router.get('/admin/campaigns', listCampaigns);
router.post('/admin/campaigns', createCampaign);
router.get('/admin/campaigns/:id', getCampaignById);
router.put('/admin/campaigns/:id', updateCampaign);
router.delete('/admin/campaigns/:id', deleteCampaign);
router.post('/admin/campaigns/:id/send', sendCampaignNow);
router.post('/admin/campaigns/:id/test', sendCampaignTestEmail);

module.exports = router;
