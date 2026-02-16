const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/eventduel/pvpGameController");
const Game = require("../../models/Game");
const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");

const eventduelAccess = [protect, checkPermission.eventduel];

router.post(
  "/",
  eventduelAccess,
  activityLogger({
    logType: "create",
    itemType: "Game",
    module: "EventDuel",
  }),
  gameController.createGame,
);
router.get("/business/:slug", eventduelAccess, gameController.getGamesByBusinessSlug);
router.get("/", eventduelAccess, gameController.getGamesByBusinessSlug);
router.get("/:id", eventduelAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put(
  "/:id",
  eventduelAccess,
  activityLogger({
    logType: "update",
    itemType: "Game",
    module: "EventDuel",
    getItemId: (req) => req.params.id,
  }),
  gameController.updateGame,
);
router.delete(
  "/:id",
  eventduelAccess,
  activityLogger({
    logType: "delete",
    itemType: "Game",
    module: "EventDuel",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: async (req) => {
      const game = await Game.findById(req.params.id).select("businessId").lean();
      return game?.businessId ?? null;
    },
  }),
  gameController.deleteGame,
);

module.exports = router;
