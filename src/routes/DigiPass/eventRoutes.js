const express = require("express");
const router = express.Router();
const {
    getEventDetails,
    getEventById,
    getEventBySlug,
    createEvent,
    updateEvent,
    deleteEvent,
} = require("../../controllers/DigiPass/eventController");

const { protect, checkPermission } = require("../../middlewares/auth");

const digiPassAccess = [protect, checkPermission.digipass];

// Get all events
router.get("/", digiPassAccess, getEventDetails);

// Get a single event by slug
router.get("/slug/:slug", getEventBySlug);

// Get a single event by ID
router.get("/:id", getEventById);

// Create event
router.post("/", digiPassAccess, createEvent);

// Update event
router.put("/:id", digiPassAccess, updateEvent);

// Delete an event
router.delete("/:id", digiPassAccess, deleteEvent);

module.exports = router;

