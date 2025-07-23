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

// PvP session flow
router.post("/start", eventduelAccess, startGameSession);
router.post("/join", joinGameSession);
router.put("/:sessionId/activate", eventduelAccess, activateGameSession);
router.put("/:sessionId/end", eventduelAccess, endGameSession);
router.patch("/:sessionId/:playerId/submit", eventduelAccess, submitPvPResult);

router.get("/leaderboard/:gameSlug", eventduelAccess, getLeaderboard);
router.get("/export/:gameSlug", eventduelAccess, exportResults);

// Reset all sessions for a specific game
router.post("/reset", eventduelAccess, resetGameSessions);
module.exports = router;
