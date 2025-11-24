const express = require("express");
const router = express.Router();

const {
  getAvailableQuestions,
  getQuestionDistribution,
  getTimeDistribution,
  getInsightsSummary,
} = require("../../controllers/SurveyGuru/insightsController");

const { protect, checkPermission } = require("../../middlewares/auth");
const surveyGuruAccess = [protect, checkPermission.surveyguru];

// Get available questions for insights
router.get("/forms/:slug/questions", surveyGuruAccess, getAvailableQuestions);

// Get question distribution for pie charts
router.get("/forms/:slug/distribution", surveyGuruAccess, getQuestionDistribution);

// Get time-based distribution for line charts
router.get("/forms/:slug/time-distribution", surveyGuruAccess, getTimeDistribution);

// Get summary statistics
router.get("/forms/:slug/summary", surveyGuruAccess, getInsightsSummary);

module.exports = router;

