const express = require("express");
const router = express.Router();
const {
  createRegistration,
  getRegistrationsByEvent,
  deleteRegistration,
  getAllCheckInRegistrationsByEvent,
} = require("../../controllers/CheckIn/registrationController");

const { protect, checkPermission } = require("../../middlewares/auth");
const CheckInAccess = [protect, checkPermission.checkin];

// Create a new public registration (no auth required)
router.post("/", createRegistration);

// Get paginated registrations for a specific event (protected)
router.get("/event/:slug", CheckInAccess, getRegistrationsByEvent);

// Delete a registration by ID (protected)
router.delete("/:id", CheckInAccess, deleteRegistration);

// GET all registrations by event slug (no pagination) — for export
router.get(
  "/event/:slug/all",
  CheckInAccess,
  getAllCheckInRegistrationsByEvent
);

module.exports = router;
