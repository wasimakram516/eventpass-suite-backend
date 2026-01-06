const express = require("express");
const router = express.Router();

const { protect } = require("../../middlewares/auth");
const {
  getWhatsAppLogs,
  getWhatsAppLogsByRegistration,
  getWhatsAppLogById,
} = require("../../controllers/notifications/whatsappLogController");

const whatsappLogAccess = [
  protect
];

// Protected (admin / business users)
router.get("/", whatsappLogAccess, getWhatsAppLogs);
router.get(
  "/registration/:registrationId",
  whatsappLogAccess,
  getWhatsAppLogsByRegistration
);
router.get("/:id", whatsappLogAccess, getWhatsAppLogById);

module.exports = router;
