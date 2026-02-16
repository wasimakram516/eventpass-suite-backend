const express = require("express");
const router = express.Router();
const {
  getQuestionsByBusiness,
  submitQuestion,
  updateQuestion,
  deleteQuestion,
  voteQuestion,
} = require("../../controllers/stageq/questionController");

const { protect } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const EventQuestion = require("../../models/EventQuestion");

const preFetchQuestionBusinessId = async (req) => {
  const q = await EventQuestion.findById(req.params.questionId).select("business").lean();
  return q?.business ?? null;
};

// Public route (creation from public page — no activity log)
router.post("/:businessSlug", submitQuestion);

// Business or Admin
router.get("/:businessSlug", getQuestionsByBusiness);
router.put("/vote/:questionId", voteQuestion);
router.put(
  "/:questionId",
  protect,
  activityLogger({
    logType: "update",
    itemType: "Question",
    module: "StageQ",
    getItemId: (req) => req.params.questionId,
    preFetchBusinessId: preFetchQuestionBusinessId,
  }),
  updateQuestion
);
router.delete(
  "/:questionId",
  protect,
  activityLogger({
    logType: "delete",
    itemType: "Question",
    module: "StageQ",
    getItemId: (req) => req.params.questionId,
    preFetchBusinessId: preFetchQuestionBusinessId,
  }),
  deleteQuestion
);

module.exports = router;
