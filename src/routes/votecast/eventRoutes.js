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
const activityLogger = require("../../middlewares/activityLogger");
const Event = require("../../models/Event");
const Business = require("../../models/Business");

const votecastAccess = [protect, checkPermission.votecast];

const preFetchEventBusinessId = async (req) => {
    const event = await Event.findById(req.params.id).select("businessId").lean();
    return event?.businessId ?? null;
};

const preFetchBusinessIdFromSlug = async (req) => {
    const business = await Business.findOne({ slug: req.body?.businessSlug }).select("_id").lean();
    return business?._id ?? null;
};

// Get all events
router.get("/", votecastAccess, getEventDetails);

// Get a single event by slug
router.get("/slug/:slug", getEventBySlug);

// Get a single event by ID
router.get("/:id", getEventById);

// Create event
router.post(
    "/",
    votecastAccess,
    activityLogger({
        logType: "create",
        itemType: "Event",
        module: "VoteCast",
        preFetchBusinessId: preFetchBusinessIdFromSlug,
    }),
    createEvent,
);

// Update event
router.put(
    "/:id",
    votecastAccess,
    activityLogger({
        logType: "update",
        itemType: "Event",
        module: "VoteCast",
        getItemId: (req) => req.params.id,
        preFetchBusinessId: preFetchEventBusinessId,
    }),
    updateEvent,
);

// Delete an event
router.delete(
    "/:id",
    votecastAccess,
    activityLogger({
        logType: "delete",
        itemType: "Event",
        module: "VoteCast",
        getItemId: (req) => req.params.id,
        preFetchBusinessId: preFetchEventBusinessId,
    }),
    deleteEvent,
);

module.exports = router;

