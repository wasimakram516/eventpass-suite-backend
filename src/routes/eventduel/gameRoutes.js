const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/eventduel/pvpGameController");
const { protect, checkPermission } = require("../../middlewares/auth");

const eventduelAccess = [protect, checkPermission.eventduel];

router.post("/", eventduelAccess, gameController.createGame);
router.get("/business/:slug", eventduelAccess, gameController.getGamesByBusinessSlug);
router.get("/", eventduelAccess, gameController.getGamesByBusinessSlug);
router.get("/:id", eventduelAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put("/:id", eventduelAccess, gameController.updateGame);
router.delete("/:id", eventduelAccess, gameController.deleteGame);

module.exports = router;
