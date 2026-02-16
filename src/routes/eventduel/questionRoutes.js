const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadMiddleware");
const Game = require("../../models/Game");
const {
  uploadQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  getQuestions,
  downloadSampleTemplate,
} = require("../../controllers/eventduel/pvpQuestionController");

const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const eventduelAccess = [protect, checkPermission.eventduel];

const preFetchGameBusinessId = async (req) => {
  const game = await Game.findById(req.params.gameId).select("businessId").lean();
  return game?.businessId ?? null;
};

// Sample Excel template
router.get("/sample/download/:choicesCount", eventduelAccess, downloadSampleTemplate);

// Excel upload (per-question logs created in controller)
router.post("/upload/:gameId", eventduelAccess, upload.single("file"), uploadQuestions);

// Manual CRUD
router.get("/:gameId", eventduelAccess, getQuestions);
router.post(
  "/:gameId",
  eventduelAccess,
  activityLogger({
    logType: "create",
    itemType: "Question",
    module: "EventDuel",
    getItemId: (req, data) => data?._id ?? null,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  addQuestion,
);
router.put(
  "/:gameId/:questionId",
  eventduelAccess,
  activityLogger({
    logType: "update",
    itemType: "Question",
    module: "EventDuel",
    getItemId: (req) => req.params.questionId,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  updateQuestion,
);
router.delete(
  "/:gameId/:questionId",
  eventduelAccess,
  activityLogger({
    logType: "delete",
    itemType: "Question",
    module: "EventDuel",
    getItemId: (req) => req.params.questionId,
    preFetchBusinessId: preFetchGameBusinessId,
  }),
  deleteQuestion,
);

module.exports = router;
