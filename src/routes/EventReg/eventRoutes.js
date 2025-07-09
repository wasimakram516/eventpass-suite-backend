const express = require("express");
const router = express.Router();
const {
  getEventDetails,
  getEventById,
  getEventBySlug,
  createEvent,
  updateEvent,
  deleteEvent,
} = require("../../controllers/EventReg/eventController");
const { protect, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const eventRegAccess = [protect, checkPermission.eventreg];

// GET all events for a business
router.get("/", eventRegAccess, getEventDetails);

// GET a single event by slug
router.get("/slug/:slug", getEventBySlug);

// GET a single event by ID
router.get("/:id", getEventById);

// CREATE public event
router.post("/", eventRegAccess, upload.fields([{ name: "logo", maxCount: 1 }]), createEvent);

// UPDATE public event
router.put("/:id", eventRegAccess, upload.fields([{ name: "logo", maxCount: 1 }]), updateEvent);

// DELETE public event
router.delete("/:id", eventRegAccess, deleteEvent);

module.exports = router;
