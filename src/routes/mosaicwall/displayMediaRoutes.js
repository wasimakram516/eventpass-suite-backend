const express = require("express");
const router = express.Router();
const { protect, checkPermission } = require("../../middlewares/auth");
const {
  getDisplayMedia,
  getMediaById,
  createDisplayMedia,
  updateDisplayMedia,
  deleteDisplayMedia
} = require("../../controllers/mosaicwall/displayMediaController");
const upload = require("../../middlewares/uploadMiddleware");
const mosaicwallAccess = [protect, checkPermission.mosaicwall];

// Protected Routes
router.put("/:id", mosaicwallAccess, upload.single("image"), updateDisplayMedia);
router.delete("/:id", mosaicwallAccess, deleteDisplayMedia);

// Public Routes
router.post("/upload/:slug", upload.single("image"), createDisplayMedia);
router.get("/", getDisplayMedia);
router.get("/:id", getMediaById);

module.exports = router;
