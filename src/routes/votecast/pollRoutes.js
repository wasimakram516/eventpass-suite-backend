const express = require("express");
const router = express.Router();
const pollController = require("../../controllers/votecast/pollController");
const { protect, checkPermission } = require("../../middlewares/auth");

// VoteCast module access control
const votecastAccess = [protect, checkPermission.votecast];

// Protected admin/business routes
router.get("/", votecastAccess, pollController.getPolls);
router.post("/", votecastAccess, pollController.createPoll);
router.put("/:id", votecastAccess, pollController.updatePoll);
router.delete("/:id", votecastAccess, pollController.deletePoll);
router.post("/:id/clone", votecastAccess, pollController.clonePoll);
router.post("/reset", votecastAccess, pollController.resetVotes);
router.post("/export", votecastAccess, pollController.exportPollsToExcel);

// Public vote route
router.post("/:id/vote", pollController.voteOnPoll);

// Public routes for results and active polls
router.get("/results", pollController.getPollResults);
router.get("/public/:businessSlug", pollController.getActivePollsByBusiness);

module.exports = router;
