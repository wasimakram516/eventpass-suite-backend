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
const mosaicwallAccess = [protect, checkPermission.mosaicwall];

router.post("/", mosaicwallAccess, createWallConfig);
router.get("/", getWallConfigs);
router.get("/slug/:slug", getWallConfigBySlug);
router.put("/:id", mosaicwallAccess, updateWallConfig);
router.delete("/:id", mosaicwallAccess, deleteWallConfig);

module.exports = router;
