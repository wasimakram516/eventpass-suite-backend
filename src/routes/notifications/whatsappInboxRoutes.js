const express = require("express");
const router = express.Router();

const { protect } = require("../../middlewares/auth");

const {
  getWhatsAppInbox,
  getWhatsAppConversation,
  sendWhatsAppReply,
} = require("../../controllers/notifications/whatsappInboxController");

const inboxAccess = [protect];

/* =========================
   WHATSAPP INBOX
========================= */

// Grouped inbox (one row per phone)
router.get("/", inboxAccess, getWhatsAppInbox);

// Full conversation for one phone
router.get("/conversation", inboxAccess, getWhatsAppConversation);

// Send manual reply
router.post("/reply", inboxAccess, sendWhatsAppReply);

module.exports = router;
    