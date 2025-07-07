const express = require("express");
const router = express.Router();
const playerController = require("../../controllers/quiznest/QNplayerController");
const { protect, checkPermission } = require("../../middlewares/auth");

const quiznestAccess = [protect, checkPermission.quiznest];

// Public routes
router.post("/:gameId", playerController.joinGame);
router.patch("/:id", playerController.submitResult);

// Protected routes
router.get("/leaderboard/:gameId", quiznestAccess, playerController.getLeaderboard);
router.get("/export/:gameId", quiznestAccess, playerController.exportResults);
router.get("/:gameId", quiznestAccess, playerController.getPlayersByGame);

module.exports = router;
