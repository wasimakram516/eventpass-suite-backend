const express = require("express");
const router = express.Router();
const questionController = require("../../controllers/quiznest/QNquestionController");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const quiznestAccess = [protect, checkPermission.quiznest];
const quiznestAdmin = [protect, checkPermission.quiznest, adminOnly];

// Sample template download (public)
router.get("/sample/download/:choicesCount", questionController.downloadSampleTemplate);

// Excel upload
router.post("/upload/:gameId", quiznestAdmin, upload.single("file"), questionController.uploadQuestions);

// Manual CRUD
router.get("/:gameId", quiznestAccess, questionController.getQuestions);
router.post("/:gameId", quiznestAdmin, questionController.addQuestion);
router.put("/:gameId/:questionId", quiznestAdmin, questionController.updateQuestion);
router.delete("/:gameId/:questionId", quiznestAdmin, questionController.deleteQuestion);

module.exports = router;
