const express = require("express");
const router = express.Router();
const {
  getEventDetails,
  getEventById,
  getEventBySlug,
  getEventsByBusinessId,
  getEventsByBusinessSlug,
  createEvent,
  updateEvent,
  deleteEvent,
} = require("../../controllers/EventReg/eventController");
const { protect, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const eventRegAccess = [protect, checkPermission.eventreg];
const multiUpload = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "brandingMedia", maxCount: 1 }
]);
// GET all events for a business
router.get("/", eventRegAccess, getEventDetails);

// GET a single event by slug
router.get("/slug/:slug", getEventBySlug);

// GET a single event by ID
router.get("/:id", getEventById);

// GET events by Business Id
router.get("/business/:businessId", getEventsByBusinessId);

// GET events by Business Slug
router.get("/business/slug/:slug", getEventsByBusinessSlug);

// CREATE public event
router.post("/", eventRegAccess, multiUpload, createEvent);

// UPDATE public event
router.put("/:id", eventRegAccess, multiUpload, updateEvent);

// DELETE public event
router.delete("/:id", eventRegAccess, deleteEvent);

module.exports = router;
