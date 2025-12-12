const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/tapmatch/TMgameController");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");

// Permissions
const tapmatchAccess = [protect, checkPermission.tapmatch];

// Routes
router.post("/", tapmatchAccess, gameController.createGame);
router.get("/business/:slug", gameController.getGamesByBusinessSlug);
router.get("/", tapmatchAccess, gameController.getAllGames);
router.get("/:id", tapmatchAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put("/:id", tapmatchAccess, gameController.updateGame);
router.delete("/:id", tapmatchAccess, gameController.deleteGame);

// Restore and delete operations
router.post("/:id/restore", tapmatchAccess, gameController.restoreGame);
router.delete("/:id/permanent", tapmatchAccess, gameController.permanentDeleteGame);
router.post("/restore-all", tapmatchAccess, gameController.restoreAllGames);
router.delete("/permanent-all", tapmatchAccess, gameController.permanentDeleteAllGames);

module.exports = router;
