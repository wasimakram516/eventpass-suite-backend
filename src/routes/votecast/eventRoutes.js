const express = require("express");
const router = express.Router();
const {
    getEventDetails,
    getEventById,
    getEventBySlug,
    createEvent,
    updateEvent,
    deleteEvent,
} = require("../../controllers/votecast/eventController");

const { protect, checkPermission } = require("../../middlewares/auth");

const votecastAccess = [protect, checkPermission.votecast];

// Get all events
router.get("/", votecastAccess, getEventDetails);

// Get a single event by slug
router.get("/slug/:slug", getEventBySlug);

// Get a single event by ID
router.get("/:id", getEventById);

// Create event
router.post("/", votecastAccess, createEvent);

// Update event
router.put("/:id", votecastAccess, updateEvent);

// Delete an event
router.delete("/:id", votecastAccess, deleteEvent);

module.exports = router;

