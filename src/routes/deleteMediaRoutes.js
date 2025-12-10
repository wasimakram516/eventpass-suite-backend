const express = require("express");
const router = express.Router();
const { deleteMedia } = require("../controllers/common/deleteMediaController");
const { protect } = require("../middlewares/auth");

/**
 * Universal Media Deletion Route
 */
router.post("/delete", protect, deleteMedia);

module.exports = router;

