const express = require("express");
const router = express.Router();
const { protect, checkPermission } = require("../../middlewares/auth");
const {
  getDisplayMedia,
  getMediaById,
  createDisplayMedia,
  updateDisplayMedia,
  deleteDisplayMedia
} = require("../../controllers/memorywall/displayMediaController");
const upload = require("../../middlewares/uploadMiddleware");
const activityLogger = require("../../middlewares/activityLogger");
const DisplayMedia = require("../../models/DisplayMedia");
const WallConfig = require("../../models/WallConfig");
const memorywallAccess = [protect, checkPermission.memorywall];

const preFetchMediaBusinessId = async (req) => {
  const media = await DisplayMedia.findById(req.params.id).select("wall").lean();
  if (!media?.wall) return null;
  const wall = await WallConfig.findById(media.wall).select("business").lean();
  return wall?.business ?? null;
};

// Protected Routes
router.put(
  "/:id",
  memorywallAccess,
  activityLogger({
    logType: "update",
    itemType: "DisplayMedia",
    module: "MemoryWall",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchMediaBusinessId,
  }),
  updateDisplayMedia
);
router.delete(
  "/:id",
  memorywallAccess,
  activityLogger({
    logType: "delete",
    itemType: "DisplayMedia",
    module: "MemoryWall",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchMediaBusinessId,
  }),
  deleteDisplayMedia
);

// Public Routes
router.post("/upload/:slug", createDisplayMedia);
router.get("/", getDisplayMedia);
router.get("/:id", getMediaById);

module.exports = router;
