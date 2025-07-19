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
} = require("../../controllers/eventduel/pvpGameSessionController");

const { protect, checkPermission } = require("../../middlewares/auth");
const eventduelAccess = [protect, checkPermission.eventduel];

// Public session info
router.get("/", eventduelAccess, getGameSessions);

// PvP session flow
router.post("/start", eventduelAccess, startGameSession);
router.post("/join", eventduelAccess, joinGameSession);
router.put("/:sessionId/activate", eventduelAccess, activateGameSession);
router.put("/:sessionId/end", eventduelAccess, endGameSession);
router.patch("/:sessionId/:playerId/submit", eventduelAccess, submitPvPResult);

router.get("/leaderboard/:gameId", eventduelAccess, getLeaderboard);
router.get("/export/:gameId", eventduelAccess, exportResults);
module.exports = router;
