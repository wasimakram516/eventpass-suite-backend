const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/quiznest/QNgameController");
const Game = require("../../models/Game");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");

const quiznestAccess = [protect, checkPermission.quiznest];

router.post(
  "/",
  quiznestAccess,
  activityLogger({
    logType: "create",
    itemType: "Game",
    module: "QuizNest",
  }),
  gameController.createGame,
);
router.get("/business/:slug", gameController.getGamesByBusinessSlug);
router.get("/", quiznestAccess, gameController.getAllGames);
router.get("/:id", quiznestAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put(
  "/:id",
  quiznestAccess,
  activityLogger({
    logType: "update",
    itemType: "Game",
    module: "QuizNest",
    getItemId: (req) => req.params.id,
  }),
  gameController.updateGame,
);
router.delete(
  "/:id",
  quiznestAccess,
  activityLogger({
    logType: "delete",
    itemType: "Game",
    module: "QuizNest",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: async (req) => {
      const game = await Game.findById(req.params.id).select("businessId").lean();
      return game?.businessId ?? null;
    },
  }),
  gameController.deleteGame,
);

module.exports = router;
