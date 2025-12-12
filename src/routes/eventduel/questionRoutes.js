const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadMiddleware");
const {
  uploadQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  getQuestions,
  downloadSampleTemplate,
} = require("../../controllers/eventduel/pvpQuestionController");

const { protect, checkPermission } = require("../../middlewares/auth");
const eventduelAccess = [protect, checkPermission.eventduel];

// Sample Excel template
router.get("/sample/download/:choicesCount", eventduelAccess, downloadSampleTemplate);

// Excel upload
router.post("/upload/:gameId", eventduelAccess, upload.single("file"), uploadQuestions);

// Manual CRUD
router.get("/:gameId", eventduelAccess, getQuestions);
router.post("/:gameId", eventduelAccess, addQuestion);
router.put("/:gameId/:questionId", eventduelAccess, updateQuestion);
router.delete("/:gameId/:questionId", eventduelAccess, deleteQuestion);

module.exports = router;
