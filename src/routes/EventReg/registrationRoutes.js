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
  uploadRegistrations,
  sendBulkEmails,
  unsentCount,
  updateRegistration,
  getRegistrationBatch,
} = require("../../controllers/EventReg/registrationController");

const { protect, checkPermission } = require("../../middlewares/auth");
const eventRegAccess = [protect, checkPermission.eventreg];

// Create a new public registration (no auth required)
router.post("/", createRegistration);

router.put("/:id", eventRegAccess, updateRegistration);

// GET count of unemailed registrations for an event (protected)
router.get("/event/:slug/unsent-count", eventRegAccess, unsentCount);

// SEND bulk emails to all unemailed registrations for an event (protected)
router.post("/event/:slug/bulk-email", eventRegAccess, sendBulkEmails);

// Verify registration via QR token (protected)
router.get("/verify", eventRegAccess, verifyRegistrationByToken);

// Get paginated registrations for a specific event (protected)
router.get("/event/:slug", eventRegAccess, getRegistrationsByEvent);

// GET initial registrations (first 50) - triggers background loading
router.get("/event/:slug/all", eventRegAccess, getAllPublicRegistrationsByEvent);

// GET batch of registrations for progressive loading
router.get("/event/:slug/batch", eventRegAccess, getRegistrationBatch);

// Delete a registration by ID (protected)
router.delete("/:id", eventRegAccess, deleteRegistration);

router.get("/event/:slug/sample-excel", eventRegAccess, downloadSampleExcel);
router.post("/event/:slug/upload", eventRegAccess, upload.single("file"), uploadRegistrations);

module.exports = router;
