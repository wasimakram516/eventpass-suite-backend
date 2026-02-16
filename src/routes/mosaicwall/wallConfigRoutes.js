const express = require("express");
const router = express.Router();
const {
  createWallConfig,
  getWallConfigs,
  getWallConfigBySlug,
  updateWallConfig,
  deleteWallConfig
} = require("../../controllers/mosaicwall/wallConfigController");

const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const WallConfig = require("../../models/WallConfig");
const mosaicwallAccess = [protect, checkPermission.mosaicwall];

const preFetchWallBusinessId = async (req) => {
  const config = await WallConfig.findById(req.params.id).select("business").lean();
  return config?.business ?? null;
};

const preFetchCreateBusinessId = async (req) => req.body?.businessId ?? null;

router.post(
  "/",
  mosaicwallAccess,
  activityLogger({
    logType: "create",
    itemType: "MosaicWall",
    module: "MosaicWall",
    preFetchBusinessId: preFetchCreateBusinessId,
  }),
  createWallConfig,
);
router.get("/", getWallConfigs);
router.get("/slug/:slug", getWallConfigBySlug);
router.put(
  "/:id",
  mosaicwallAccess,
  activityLogger({
    logType: "update",
    itemType: "MosaicWall",
    module: "MosaicWall",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchWallBusinessId,
  }),
  updateWallConfig,
);
router.delete(
  "/:id",
  mosaicwallAccess,
  activityLogger({
    logType: "delete",
    itemType: "MosaicWall",
    module: "MosaicWall",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchWallBusinessId,
  }),
  deleteWallConfig,
);

module.exports = router;
