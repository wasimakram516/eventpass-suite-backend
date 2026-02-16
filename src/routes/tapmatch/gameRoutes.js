const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/tapmatch/TMgameController");
const Game = require("../../models/Game");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");

// Permissions
const tapmatchAccess = [protect, checkPermission.tapmatch];

// Routes
router.post(
  "/",
  tapmatchAccess,
  activityLogger({
    logType: "create",
    itemType: "Game",
    module: "TapMatch",
  }),
  gameController.createGame,
);
router.get("/business/:slug", gameController.getGamesByBusinessSlug);
router.get("/", tapmatchAccess, gameController.getAllGames);
router.get("/:id", tapmatchAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put(
  "/:id",
  tapmatchAccess,
  activityLogger({
    logType: "update",
    itemType: "Game",
    module: "TapMatch",
    getItemId: (req) => req.params.id,
  }),
  gameController.updateGame,
);
router.delete(
  "/:id",
  tapmatchAccess,
  activityLogger({
    logType: "delete",
    itemType: "Game",
    module: "TapMatch",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: async (req) => {
      const game = await Game.findById(req.params.id).select("businessId").lean();
      return game?.businessId ?? null;
    },
  }),
  gameController.deleteGame,
);

// Restore and delete operations
router.post("/:id/restore", tapmatchAccess, gameController.restoreGame);
router.delete("/:id/permanent", tapmatchAccess, gameController.permanentDeleteGame);
router.post("/restore-all", tapmatchAccess, gameController.restoreAllGames);
router.delete("/permanent-all", tapmatchAccess, gameController.permanentDeleteAllGames);

module.exports = router;
