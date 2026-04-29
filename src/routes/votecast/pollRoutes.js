const express = require("express");
const router = express.Router();
const pollController = require("../../controllers/votecast/pollController");
const pollInsightsController = require("../../controllers/votecast/pollInsightsController");
const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const Poll = require("../../models/Poll");

const votecastAccess = [protect, checkPermission.votecast];

const preFetchPollBusinessId = async (req) => {
  const poll = await Poll.findById(req.params.id).select("business").lean();
  return poll?.business ?? null;
};

// Poll-level insights (protected)
router.get("/insights/:slug/summary", votecastAccess, pollInsightsController.getSummary);
router.get("/insights/:slug/fields", votecastAccess, pollInsightsController.getAvailableFields);
router.get("/insights/:slug/distribution", votecastAccess, pollInsightsController.getFieldDistribution);
router.get("/insights/:slug/time-distribution", votecastAccess, pollInsightsController.getTimeDistribution);

// GET all polls (protected)
router.get("/", votecastAccess, pollController.getPolls);

// GET poll meta (protected)
router.get("/:id/meta", votecastAccess, pollController.getPollMeta);

// GET questions for a poll (protected)
router.get("/:id/questions", votecastAccess, pollController.getPollQuestions);

// GET export questions as XLSX (protected)
router.get("/:id/questions/export", votecastAccess, pollController.exportQuestions);

// GET results for a single poll (protected)
router.get("/:id/results", votecastAccess, pollController.getPollResults);

// GET voter-level results for a linked poll (protected)
router.get("/:id/voter-results", votecastAccess, pollController.getPollVoterResults);

// POST create poll (protected)
router.post(
  "/",
  votecastAccess,
  activityLogger({ logType: "create", itemType: "Poll", module: "VoteCast" }),
  pollController.createPoll,
);

// PUT update poll (protected)
router.put(
  "/:id",
  votecastAccess,
  activityLogger({
    logType: "update",
    itemType: "Poll",
    module: "VoteCast",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchPollBusinessId,
  }),
  pollController.updatePoll,
);

// DELETE poll (protected)
router.delete(
  "/:id",
  votecastAccess,
  activityLogger({
    logType: "delete",
    itemType: "Poll",
    module: "VoteCast",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchPollBusinessId,
  }),
  pollController.deletePoll,
);

// POST add question to poll (protected)
router.post("/:id/questions", votecastAccess, pollController.addQuestion);

// PUT update question (protected)
router.put("/:id/questions/:questionId", votecastAccess, pollController.updateQuestion);

// DELETE question (protected)
router.delete("/:id/questions/:questionId", votecastAccess, pollController.deleteQuestion);

// POST clone question (protected)
router.post("/:id/questions/:questionId/clone", votecastAccess, pollController.cloneQuestion);

// POST clone poll (protected)
router.post("/:id/clone", votecastAccess, pollController.clonePoll);

// POST reset votes (protected)
router.post("/reset", votecastAccess, pollController.resetVotes);

// PUBLIC: verify attendee by poll ID
router.post("/verify-by-poll", pollController.verifyAttendeeByPoll);

// PUBLIC: verify attendee via VoteCast event slug (legacy)
router.post("/verify", pollController.verifyAttendee);

// PUBLIC: vote on a question
router.post("/:id/vote", pollController.voteOnPoll);

// PUBLIC: get poll by slug
router.get("/slug/:slug", pollController.getPollBySlug);

// PUBLIC: get single poll by ID
router.get("/public/poll/:pollId", pollController.getPublicPollById);

// PUBLIC: get polls for VoteCast event (legacy)
router.get("/public/:eventSlug", pollController.getActivePollsByEvent);

module.exports = router;
