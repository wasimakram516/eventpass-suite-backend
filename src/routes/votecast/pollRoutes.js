const express = require("express");
const router = express.Router();
const pollController = require("../../controllers/votecast/pollController");
const { protect, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

// VoteCast module access control
const votecastAccess = [protect, checkPermission.votecast];

// GET all polls (protected)
router.get("/", votecastAccess, pollController.getPolls);

// POST create poll with images
router.post(
  "/",
  votecastAccess,
  upload.array("images", 10), 
  pollController.createPoll
);

// PUT update poll with optional image replacements
router.put(
  "/:id",
  votecastAccess,
  upload.array("images", 10), 
  pollController.updatePoll
);

// DELETE poll
router.delete("/:id", votecastAccess, pollController.deletePoll);

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
router.get("/public/:businessSlug", pollController.getActivePollsByBusiness);

module.exports = router;
