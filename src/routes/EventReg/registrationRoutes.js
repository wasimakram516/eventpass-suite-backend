const express = require("express");
const router = express.Router();
const {
  createRegistration,
  getRegistrationsByEvent,
  verifyRegistrationByToken,
  deleteRegistration,
} = require("../../controllers/EventReg/registrationController");

const { protect, checkPermission } = require("../../middlewares/auth");
const eventRegAccess = [protect, checkPermission.eventreg];


// Create a new public registration (no auth required)
router.post("/", createRegistration);

// Verify registration via QR token (protected)
router.get("/verify", eventRegAccess, verifyRegistrationByToken);

// Get paginated registrations for a specific event (protected)
router.get("/event/:slug", eventRegAccess, getRegistrationsByEvent);

// Delete a registration by ID (protected)
router.delete("/:id", eventRegAccess, deleteRegistration);

module.exports = router;
