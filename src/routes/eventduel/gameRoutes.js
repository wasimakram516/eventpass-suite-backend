const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/eventduel/pvpGameController");
const { protect, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const eventduelAccess = [protect, checkPermission.eventduel];

// Upload up to 3 images
const gameImageUpload = upload.fields([
  { name: "cover", maxCount: 1 },
  { name: "name", maxCount: 1 },
  { name: "background", maxCount: 1 },
]);

router.post("/", eventduelAccess, gameImageUpload, gameController.createGame);
router.get("/business/:slug", eventduelAccess, gameController.getGamesByBusinessSlug);
router.get("/", eventduelAccess, gameController.getGamesByBusinessSlug);
router.get("/:id", eventduelAccess, gameController.getGameById);
router.get("/slug/:slug", eventduelAccess, gameController.getGameBySlug);
router.put("/:id", eventduelAccess, gameImageUpload, gameController.updateGame);
router.delete("/:id", eventduelAccess, gameController.deleteGame);

module.exports = router;
