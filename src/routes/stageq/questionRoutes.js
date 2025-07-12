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

// Public route
router.post("/:businessSlug", submitQuestion);

// Business or Admin
router.get("/:businessSlug", protect, getQuestionsByBusiness);
router.put("/vote/:questionId", voteQuestion);
router.put("/:questionId", protect, updateQuestion);
router.delete("/:questionId", protect, deleteQuestion);

module.exports = router;
