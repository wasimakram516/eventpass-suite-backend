const express = require("express");
const router = express.Router();
const playerController = require("../../controllers/tapmatch/TMplayerController");
const { protect, checkPermission } = require("../../middlewares/auth");

const tapmatchAccess = [protect, checkPermission.tapmatch];

// Public routes (player side)
router.post("/:gameId/start", playerController.joinGame);
router.patch("/:sessionId/:playerId/submit", playerController.submitResult);

// Protected routes (CMS/Admin side)
router.get("/leaderboard/:gameId", tapmatchAccess, playerController.getLeaderboard);
router.get("/export/:gameId", tapmatchAccess, playerController.exportResults);
router.get("/:gameId", tapmatchAccess, playerController.getPlayersByGame);

module.exports = router;
