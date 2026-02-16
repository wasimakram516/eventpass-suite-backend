const express = require("express");
const router = express.Router();
const pollController = require("../../controllers/votecast/pollController");
const { protect, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");
const activityLogger = require("../../middlewares/activityLogger");
const Poll = require("../../models/Poll");
const Event = require("../../models/Event");

// VoteCast module access control
const votecastAccess = [protect, checkPermission.votecast];

const preFetchPollBusinessId = async (req) => {
  const poll = await Poll.findById(req.params.id).select("business").lean();
  return poll?.business ?? null;
};

const preFetchPollCreateBusinessId = async (req) => {
  const eventId = req.body?.eventId;
  if (!eventId) return null;
  const event = await Event.findById(eventId).select("businessId").lean();
  return event?.businessId ?? null;
};

// GET all polls (protected)
router.get("/", votecastAccess, pollController.getPolls);

// POST create poll with images
router.post(
  "/",
  votecastAccess,
  activityLogger({
    logType: "create",
    itemType: "Poll",
    module: "VoteCast",
    preFetchBusinessId: preFetchPollCreateBusinessId,
  }),
  pollController.createPoll,
);

// PUT update poll with optional image replacements
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

// DELETE poll
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

// Clone existing poll
router.post("/:id/clone", votecastAccess, pollController.clonePoll);

// Reset votes
router.post("/reset", votecastAccess, pollController.resetVotes);

// Export polls to Excel
router.post("/export", votecastAccess, pollController.exportPollsToExcel);

// PUBLIC vote on poll
router.post("/:id/vote", pollController.voteOnPoll);

// PUBLIC results and public polls
router.get("/results", pollController.getPollResults);
router.get("/public/:eventSlug", pollController.getActivePollsByEvent);

module.exports = router;
