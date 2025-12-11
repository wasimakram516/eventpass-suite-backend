const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/quiznest/QNgameController");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");

const quiznestAccess = [protect, checkPermission.quiznest];

router.post("/", quiznestAccess, gameController.createGame);
router.get("/business/:slug", gameController.getGamesByBusinessSlug);
router.get("/", quiznestAccess, gameController.getAllGames);
router.get("/:id", quiznestAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put("/:id", quiznestAccess, gameController.updateGame);
router.delete("/:id", quiznestAccess, gameController.deleteGame);

module.exports = router;
