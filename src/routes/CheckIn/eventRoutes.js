const express = require("express");
const router = express.Router();
const {
  getEventDetails,
  getEventById,
  getEventBySlug,
  createEvent,
  updateEvent,
  deleteEvent,
} = require("../../controllers/CheckIn/eventController");
const {
  downloadEmployeeTemplate,
} = require("../../controllers/common/downloadController");

const { protect, checkPermission } = require("../../middlewares/auth");

const checkInAccess = [protect, checkPermission.checkin];

// Download employeeData Template
router.get("/download-template", checkInAccess, downloadEmployeeTemplate);

// Get all events
router.get("/", checkInAccess, getEventDetails);

// Get a single event by slug
router.get("/slug/:slug", getEventBySlug);

// Get a single event by ID
router.get("/:id", getEventById);

// Create event
router.post(
  "/",
  checkInAccess,
  createEvent
);

// Update event
router.put(
  "/:id",
  checkInAccess,
  updateEvent
);

// Delete an event
router.delete("/:id", checkInAccess, deleteEvent);

module.exports = router;
