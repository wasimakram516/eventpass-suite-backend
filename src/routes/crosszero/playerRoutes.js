const express = require("express");
const router = express.Router();
const {
  joinGame,
  submitResult,
  getSessionHistory,
  exportResults,
} = require("../../controllers/crosszero/CZplayerController");
const { protect, checkPermission } = require("../../middlewares/auth");

const czAccess = [protect, checkPermission.crosszero];

// Public — AI mode player flow
router.post("/:gameId", joinGame);
router.patch("/:sessionId/:playerId/submit", submitResult);

// Admin — session history & export
router.get("/history/:gameId", czAccess, getSessionHistory);
router.get("/export/:gameId", czAccess, exportResults);

module.exports = router;
