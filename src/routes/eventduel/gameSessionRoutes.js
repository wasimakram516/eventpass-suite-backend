const express = require("express");
const router = express.Router();
const {
  getGameSessions,
  startGameSession,
  joinGameSession,
  activateGameSession,
  submitPvPResult,
  endGameSession,
  getLeaderboard,
  exportResults,
  resetGameSessions,
} = require("../../controllers/eventduel/pvpGameSessionController");

const { protect, checkPermission } = require("../../middlewares/auth");
const eventduelAccess = [protect, checkPermission.eventduel];

// Public session info
router.get("/", getGameSessions);
router.patch("/:sessionId/:playerId/submit", submitPvPResult);
router.post("/join", joinGameSession);

// PvP session flow
router.post("/start", eventduelAccess, startGameSession);
router.put("/:sessionId/activate", eventduelAccess, activateGameSession);
router.put("/:sessionId/end", eventduelAccess, endGameSession);
router.get("/leaderboard/:gameSlug", eventduelAccess, getLeaderboard);
router.get("/export/:gameSlug", eventduelAccess, exportResults);

// Reset all sessions for a specific game
router.post("/reset", eventduelAccess, resetGameSessions);
module.exports = router;
