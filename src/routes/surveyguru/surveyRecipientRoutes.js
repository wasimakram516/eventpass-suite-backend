const express = require("express");
const router = express.Router();
const { protect, checkPermission } = require("../../middlewares/auth");
const rc = require("../../controllers/SurveyGuru/recipientController");

const access = [protect, checkPermission.surveyguru];

// Get recipients for a form
router.get("/recipients", access, rc.listRecipients);

// Sync recipients from event registrations
router.post("/forms/:formId/recipients/sync", access, rc.syncFromEventRegistrations);

// Delete single recipient
router.delete("/recipients/:id", access, rc.deleteRecipient);

// Clear all recipients for a form
router.delete("/forms/:formId/recipients", access, rc.clearRecipients);

// Export recipients CSV (requires formId query param)
router.get("/recipients/export", access, rc.exportRecipients);

module.exports = router;
