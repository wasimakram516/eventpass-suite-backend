const express = require("express");
const router = express.Router();

const {
  twilioWhatsAppStatusWebhook,
  twilioWhatsAppInboundWebhook,
} = require("../../controllers/webhooks/twilioWhatsAppWebhookController");

// Status updates
router.post("/status", twilioWhatsAppStatusWebhook);

// Incoming user replies
router.post("/inbound", twilioWhatsAppInboundWebhook);

module.exports = router;
