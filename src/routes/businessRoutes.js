const express = require("express");
const router = express.Router();
const businessController = require("../controllers/businessController");
const { protect, adminOnly } = require("../middlewares/auth");
const upload = require("../middlewares/uploadMiddleware");

// CREATE business - protected (accessible to all roles)
router.post(
  "/",
  protect,
  upload.single("file"),
  businessController.createBusiness
);

// GET all businesses – protected (accessible to all roles)
router.get("/", protect, businessController.getAllBusinesses);

// GET business by ID – protected
router.get("/:id", protect, businessController.getBusinessById);

// GET business by slug – public route (no auth)
router.get("/slug/:slug", businessController.getBusinessBySlug);

// UPDATE business protected (accessible to all roles)
router.put(
  "/:id",
  protect,
  upload.single("file"),
  businessController.updateBusiness
);

// DELETE business – admin only
router.delete("/:id", protect, adminOnly, businessController.deleteBusiness);

module.exports = router;
