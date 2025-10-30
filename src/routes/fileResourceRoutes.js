const express = require("express");
const router = express.Router();

const {
  createFileResource,
  updateFileResource,
  getAllFiles,
  getFileById,
  getFileBySlug,
  deleteFileResource,
} = require("../controllers/fileResourceController");

const { protect } = require("../middlewares/auth");
const upload = require("../middlewares/uploadMiddleware");

const singleUpload = upload.single("file");

// ==========================================
// GET all files (optionally by businessSlug)
// ==========================================
router.get("/", protect, getAllFiles);

// ==========================================
// GET file by ID
// ==========================================
router.get("/:id", protect, getFileById);

// ==========================================
// GET file by slug (public route)
// ==========================================
router.get("/slug/:slug", getFileBySlug);

// ==========================================
// CREATE new file (Upload to S3)
// ==========================================
router.post("/", singleUpload, protect, createFileResource); 

// ========================================== 
// UPDATE file (Replace existing S3 object)
// ==========================================
router.put("/:id", singleUpload, protect, updateFileResource);

// ==========================================
// DELETE file
// ==========================================
router.delete("/:id", protect, deleteFileResource);

module.exports = router;
