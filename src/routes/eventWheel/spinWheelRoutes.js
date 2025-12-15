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

const eventWheelAccess = [protect, checkPermission.eventwheel];

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
  createSpinWheel
);

// UPDATE spin wheel
router.put(
  "/:id",
  eventWheelAccess,
  updateSpinWheel
);

// DELETE spin wheel
router.delete("/:id", eventWheelAccess, deleteSpinWheel);

module.exports = router;
