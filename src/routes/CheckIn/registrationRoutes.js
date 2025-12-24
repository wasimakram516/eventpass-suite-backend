const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const {
  createRegistration,
  getRegistrationsByEvent,
  deleteRegistration,
  getAllCheckInRegistrationsByEvent,
  downloadSampleExcel,
  uploadRegistrations,
  updateRegistration,
  updateRegistrationApproval,
  exportRegistrations,
  verifyRegistrationByToken,
  createWalkIn,
  getRegistrationByToken,
  confirmPresence,
  sendBulkEmails,
} = require("../../controllers/CheckIn/registrationController");

const { protect, checkPermission } = require("../../middlewares/auth");
const CheckInAccess = [protect, checkPermission.checkin];

// Create a new public registration (no auth required)
router.post("/", createRegistration);

// Public endpoints for token-based confirmation
router.get("/by-token", getRegistrationByToken);
router.post("/confirm-presence", confirmPresence);

// Update registration
router.put("/:id", CheckInAccess, updateRegistration);

// Update registration approval status
router.patch("/:id/approval", CheckInAccess, updateRegistrationApproval);

// Create walkin record for a registration (protected)
router.post("/:id/walkin", CheckInAccess, createWalkIn);

// SEND bulk emails to all registrations for an event (protected)
router.post("/event/:slug/bulk-email", CheckInAccess, sendBulkEmails);

// Verify registration via QR token (protected)
router.get("/verify", CheckInAccess, verifyRegistrationByToken);

// Get paginated registrations for a specific event (protected)
router.get("/event/:slug", CheckInAccess, getRegistrationsByEvent);

// GET initial registrations (first batch) & streaming via sockets
router.get("/event/:slug/all", CheckInAccess, getAllCheckInRegistrationsByEvent);

// EXPORT registrations (supports filters)
router.get("/event/:slug/export", CheckInAccess, exportRegistrations);

// Delete a registration by ID (protected)
router.delete("/:id", CheckInAccess, deleteRegistration);

// Sample Excel and upload
router.get("/event/:slug/sample-excel", CheckInAccess, downloadSampleExcel);
router.post(
  "/event/:slug/upload",
  CheckInAccess,
  upload.single("file"),
  uploadRegistrations
);

module.exports = router;
