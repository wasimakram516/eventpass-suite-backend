const express = require("express");
const router = express.Router();
const gameController = require("../../controllers/tapmatch/TMgameController");
const { protect, adminOnly, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

// Permissions
const tapmatchAccess = [protect, checkPermission.tapmatch];

// Upload fields: cover, name, background, memoryImages[]
const gameImageUpload = upload.fields([
  { name: "cover", maxCount: 1 },
  { name: "name", maxCount: 1 },
  { name: "background", maxCount: 1 },
  { name: "memoryImages", maxCount: 50 },
]);

// Routes
router.post("/", tapmatchAccess, gameImageUpload, gameController.createGame);
router.get("/business/:slug", gameController.getGamesByBusinessSlug);
router.get("/", tapmatchAccess, gameController.getAllGames);
router.get("/:id", tapmatchAccess, gameController.getGameById);
router.get("/slug/:slug", gameController.getGameBySlug);
router.put("/:id", tapmatchAccess, gameImageUpload, gameController.updateGame);
router.delete("/:id", tapmatchAccess, gameController.deleteGame);

// Restore and delete operations
router.post("/:id/restore", tapmatchAccess, gameController.restoreGame);
router.delete("/:id/permanent", tapmatchAccess, gameController.permanentDeleteGame);
router.post("/restore-all", tapmatchAccess, gameController.restoreAllGames);
router.delete("/permanent-all", tapmatchAccess, gameController.permanentDeleteAllGames);

module.exports = router;
