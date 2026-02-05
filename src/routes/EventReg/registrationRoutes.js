const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();

const {
  createRegistration,
  getRegistrationsByEvent,
  verifyRegistrationByToken,
  deleteRegistration,
  getAllPublicRegistrationsByEvent,
  downloadSampleExcel,
  downloadCountryReference,
  uploadRegistrations,
  sendBulkEmails,
  sendBulkWhatsApp,
  unsentCount,
  updateRegistration,
  updateRegistrationApproval,
  bulkUpdateRegistrationApproval,
  exportRegistrations,
  createWalkIn,
} = require("../../controllers/EventReg/registrationController");

const { protect, optionalProtect, checkPermission } = require("../../middlewares/auth");
const eventRegAccess = [protect, checkPermission.eventreg];

// Create registration: public (no auth) or CMS (token optional — sets createdBy when present)
router.post("/", optionalProtect, createRegistration);

router.put("/:id", eventRegAccess, updateRegistration);

// Update registration approval status
router.patch("/:id/approval", eventRegAccess, updateRegistrationApproval);

// Bulk update approval status
router.patch(
  "/event/:slug/approval/bulk",
  eventRegAccess,
  bulkUpdateRegistrationApproval
);

// Create walkin record for a registration (protected)
router.post("/:id/walkin", eventRegAccess, createWalkIn);

// GET count of unemailed registrations for an event (protected)
router.get("/event/:slug/unsent-count", eventRegAccess, unsentCount);

// SEND bulk emails to all unemailed registrations for an event (protected)
router.post("/event/:slug/bulk-email", eventRegAccess, upload.single("file"), sendBulkEmails);

router.post("/event/:slug/bulk-whatsapp", eventRegAccess, upload.single("file"), sendBulkWhatsApp);

// Verify registration via QR token (protected)
router.get("/verify", eventRegAccess, verifyRegistrationByToken);

// Get paginated registrations for a specific event (protected)
router.get("/event/:slug", eventRegAccess, getRegistrationsByEvent);

// GET initial registrations (first 50) - triggers background loading
router.get("/event/:slug/all", eventRegAccess, getAllPublicRegistrationsByEvent);

// EXPORT registrations (supports filters)
router.get("/event/:slug/export", eventRegAccess, exportRegistrations);

// Delete a registration by ID (protected)
router.delete("/:id", eventRegAccess, deleteRegistration);

router.get("/event/:slug/sample-excel", eventRegAccess, downloadSampleExcel);
router.get("/country-reference", eventRegAccess, downloadCountryReference);
router.post("/event/:slug/upload", eventRegAccess, upload.single("file"), uploadRegistrations);

module.exports = router;
