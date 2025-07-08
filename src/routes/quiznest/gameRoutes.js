const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/quiznest/QNgameController");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const quiznestAccess = [protect, checkPermission.quiznest];

// Upload up to 3 images: cover, name, background
const gameImageUpload = upload.fields([
  { name: "cover", maxCount: 1 },
  { name: "name", maxCount: 1 },
  { name: "background", maxCount: 1 },
]);

router.post("/", quiznestAccess, gameImageUpload, gameController.createGame);
router.get("/business/:slug", gameController.getGamesByBusinessSlug);
router.get("/", quiznestAccess, gameController.getAllGames);
router.get("/:id", quiznestAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put("/:id", quiznestAccess, gameImageUpload, gameController.updateGame);
router.delete("/:id", quiznestAccess, gameController.deleteGame);

module.exports = router;
