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
const { updateEventCustomQrWrapper } = require("../../controllers/common/eventCustomQrWrapperController");
const { protect, checkPermission } = require("../../middlewares/auth");
const multer = require("../../middlewares/uploadMiddleware");
const activityLogger = require("../../middlewares/activityLogger");
const Event = require("../../models/Event");

const checkInAccess = [protect, checkPermission.checkin];
const qrWrapperUpload = multer.fields([
  { name: "qrWrapperLogo", maxCount: 1 },
  { name: "qrWrapperBackground", maxCount: 1 },
  { name: "qrWrapperBrandingMedia", maxCount: 20 },
]);

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
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "CheckIn",
  }),
  createEvent
);

// Update event
router.put(
  "/:id",
  checkInAccess,
  activityLogger({
    logType: "update",
    itemType: "Event",
    module: "CheckIn",
    getItemId: (req) => req.params.id,
    getBusinessId: (req, data) => data?.businessId ?? null,
  }),
  updateEvent
);

// Update event custom QR wrapper (closed events)
router.put("/:id/custom-qr-wrapper", checkInAccess, qrWrapperUpload, updateEventCustomQrWrapper("closed"));

// Delete an event
router.delete(
  "/:id",
  checkInAccess,
  activityLogger({
    logType: "delete",
    itemType: "Event",
    module: "CheckIn",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: async (req) => {
      const event = await Event.findById(req.params.id).select("businessId").lean();
      return event?.businessId ?? null;
    },
  }),
  deleteEvent
);

module.exports = router;
