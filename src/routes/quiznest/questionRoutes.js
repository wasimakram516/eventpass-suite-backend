const express = require("express");
const router = express.Router();
const questionController = require("../../controllers/quiznest/QNquestionController");
const Game = require("../../models/Game");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");
const activityLogger = require("../../middlewares/activityLogger");

const quiznestAccess = [protect, checkPermission.quiznest];

const preFetchGameBusinessId = async (req) => {
  const game = await Game.findById(req.params.gameId).select("businessId").lean();
  return game?.businessId ?? null;
};

// Sample template download (public)
router.get("/sample/download/:choicesCount", questionController.downloadSampleTemplate);

// Excel upload
router.post(
  "/upload/:gameId",
  quiznestAccess,
  upload.single("file"),
  activityLogger({
    logType: "update",
    itemType: "Game",
    module: "QuizNest",
    getItemId: (req) => req.params.gameId,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  questionController.uploadQuestions,
);

// Manual CRUD
router.get("/:gameId", quiznestAccess, questionController.getQuestions);
router.post(
  "/:gameId",
  quiznestAccess,
  activityLogger({
    logType: "create",
    itemType: "Question",
    module: "QuizNest",
    getItemId: (req, data) => data?._id ?? null,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  questionController.addQuestion,
);

router.put(
  "/:gameId/:questionId",
  quiznestAccess,
  activityLogger({
    logType: "update",
    itemType: "Question",
    module: "QuizNest",
    getItemId: (req) => req.params.questionId,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  questionController.updateQuestion,
);
router.delete(
  "/:gameId/:questionId",
  quiznestAccess,
  activityLogger({
    logType: "delete",
    itemType: "Question",
    module: "QuizNest",
    getItemId: (req) => req.params.questionId,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  questionController.deleteQuestion,
);

module.exports = router;
