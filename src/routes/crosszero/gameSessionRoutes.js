const express = require("express");
const router = express.Router();
const {
  getGameSessions,
  startGameSession,
  joinGameSession,
  activateGameSession,
  endGameSession,
  abandonGameSession,
  resetGameSessions,
  exportResults,
} = require("../../controllers/crosszero/CZgameSessionController");
const { protect, checkPermission } = require("../../middlewares/auth");

const czAccess = [protect, checkPermission.crosszero];

// Public — players join and view sessions
router.get("/", getGameSessions);
router.post("/start", startGameSession);
router.post("/join", joinGameSession);
router.put("/:sessionId/activate", activateGameSession);
router.put("/:sessionId/end", endGameSession);
router.put("/:sessionId/abandon", abandonGameSession);

// Admin — session maintenance
router.post("/reset", czAccess, resetGameSessions);
router.get("/export/:gameSlug", czAccess, exportResults);

module.exports = router;
