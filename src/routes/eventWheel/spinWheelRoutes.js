const express = require("express");
const router = express.Router();
const {
  getAllSpinWheels,
  getSpinWheelById,
  getSpinWheelBySlug,
  createSpinWheel,
  updateSpinWheel,
  deleteSpinWheel,
} = require("../../controllers/EventWheel/spinWheelController");

const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const SpinWheel = require("../../models/SpinWheel");

const eventWheelAccess = [protect, checkPermission.eventwheel];

const preFetchWheelBusinessId = async (req) => {
  const wheel = await SpinWheel.findById(req.params.id).select("business").lean();
  return wheel?.business ?? null;
};

const preFetchCreateWheelBusinessId = async (req) => req.body?.business ?? null;

// GET all spin wheels
router.get("/", eventWheelAccess, getAllSpinWheels);

// GET a single spin wheel by slug
router.get("/slug/:slug", getSpinWheelBySlug);

// GET a single spin wheel by ID
router.get("/:id", getSpinWheelById);

// CREATE spin wheel
router.post(
  "/",
  eventWheelAccess,
  activityLogger({
    logType: "create",
    itemType: "SpinWheel",
    module: "EventWheel",
    preFetchBusinessId: preFetchCreateWheelBusinessId,
  }),
  createSpinWheel,
);

// UPDATE spin wheel
router.put(
  "/:id",
  eventWheelAccess,
  activityLogger({
    logType: "update",
    itemType: "SpinWheel",
    module: "EventWheel",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchWheelBusinessId,
  }),
  updateSpinWheel,
);

// DELETE spin wheel
router.delete(
  "/:id",
  eventWheelAccess,
  activityLogger({
    logType: "delete",
    itemType: "SpinWheel",
    module: "EventWheel",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchWheelBusinessId,
  }),
  deleteSpinWheel,
);

module.exports = router;
