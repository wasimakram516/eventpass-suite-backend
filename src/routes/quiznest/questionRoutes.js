const express = require("express");
const router = express.Router();
const questionController = require("../../controllers/quiznest/QNquestionController");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const quiznestAccess = [protect, checkPermission.quiznest];

// Sample template download (public)
router.get("/sample/download/:choicesCount", questionController.downloadSampleTemplate);

// Excel upload
router.post("/upload/:gameId", quiznestAccess, upload.single("file"), questionController.uploadQuestions);

// Manual CRUD
router.get("/:gameId", quiznestAccess, questionController.getQuestions);
router.post("/:gameId", quiznestAccess, questionController.addQuestion);
router.put("/:gameId/:questionId", quiznestAccess, questionController.updateQuestion);
router.delete("/:gameId/:questionId", quiznestAccess, questionController.deleteQuestion);

module.exports = router;
