const express = require("express");
const router = express.Router();
const {
  createWallConfig,
  getWallConfigs,
  getWallConfigBySlug,
  updateWallConfig,
  deleteWallConfig
} = require("../../controllers/memorywall/wallConfigController");

const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const WallConfig = require("../../models/WallConfig");
const memorywallAccess = [protect, checkPermission.memorywall];

const preFetchWallBusinessId = async (req) => {
  const config = await WallConfig.findById(req.params.id).select("business").lean();
  return config?.business ?? null;
};

const preFetchCreateBusinessId = async (req) => req.body?.businessId ?? null;

router.post(
  "/",
  memorywallAccess,
  activityLogger({
    logType: "create",
    itemType: "MemoryWall",
    module: "MemoryWall",
    preFetchBusinessId: preFetchCreateBusinessId,
  }),
  createWallConfig,
);
router.get("/", getWallConfigs);
router.get("/slug/:slug", getWallConfigBySlug);
router.put(
  "/:id",
  memorywallAccess,
  activityLogger({
    logType: "update",
    itemType: "MemoryWall",
    module: "MemoryWall",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchWallBusinessId,
  }),
  updateWallConfig,
);
router.delete(
  "/:id",
  memorywallAccess,
  activityLogger({
    logType: "delete",
    itemType: "MemoryWall",
    module: "MemoryWall",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchWallBusinessId,
  }),
  deleteWallConfig,
);

module.exports = router;
