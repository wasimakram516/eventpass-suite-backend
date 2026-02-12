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
const { updateEventCustomQrWrapper } = require("../../controllers/common/eventCustomQrWrapperController");
const { protect, checkPermission } = require("../../middlewares/auth");
const multer = require("../../middlewares/uploadMiddleware");

const eventRegAccess = [protect, checkPermission.eventreg];
const qrWrapperUpload = multer.fields([
  { name: "qrWrapperLogo", maxCount: 1 },
  { name: "qrWrapperBackground", maxCount: 1 },
  { name: "qrWrapperBrandingMedia", maxCount: 20 },
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
router.post("/", eventRegAccess, createEvent);

// UPDATE public event
router.put("/:id", eventRegAccess, updateEvent);

// UPDATE event custom QR wrapper (public events)
router.put("/:id/custom-qr-wrapper", eventRegAccess, qrWrapperUpload, updateEventCustomQrWrapper("public"));

// DELETE public event
router.delete("/:id", eventRegAccess, deleteEvent);

module.exports = router;
