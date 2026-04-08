const express = require("express");
const router = express.Router();
const {
  createGame,
  updateGame,
  getGamesByBusinessSlug,
  getGameById,
  getGameBySlug,
  deleteGame,
  restoreGame,
  permanentDeleteGame,
  restoreAllGames,
  permanentDeleteAllGames,
} = require("../../controllers/crosszero/CZgameController");
const { protect, checkPermission } = require("../../middlewares/auth");

const czAccess = [protect, checkPermission.crosszero];

// Public
router.get("/business/:slug", getGamesByBusinessSlug);
router.get("/slug/:slug", getGameBySlug);
router.get("/:id", getGameById);

// Admin
router.post("/", czAccess, createGame);
router.put("/:id", czAccess, updateGame);
router.delete("/:id", czAccess, deleteGame);
router.patch("/:id/restore", czAccess, restoreGame);
router.delete("/:id/permanent", czAccess, permanentDeleteGame);
router.patch("/restore/all", czAccess, restoreAllGames);
router.delete("/permanent/all", czAccess, permanentDeleteAllGames);

module.exports = router;
