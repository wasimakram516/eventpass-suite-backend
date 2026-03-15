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
const memorywallAccess = [protect, checkPermission.memorywall];

// Protected Routes
router.put("/:id", memorywallAccess, updateDisplayMedia);
router.delete("/:id", memorywallAccess, deleteDisplayMedia);

// Public Routes
router.post("/upload/:slug", createDisplayMedia);
router.get("/", getDisplayMedia);
router.get("/:id", getMediaById);

module.exports = router;
