const express = require("express");
const router = express.Router();
const businessController = require("../controllers/businessController");

const { protect, adminOnly } = require("../middlewares/auth");
const upload = require("../middlewares/uploadMiddleware");
const activityLogger = require("../middlewares/activityLogger");

// CREATE business - protected (accessible to all roles)
router.post(
  "/",
  protect,
  upload.single("file"),
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "Other",
  }),
  businessController.createBusiness,
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
  activityLogger({
    logType: "update",
    itemType: "Event",
    module: "Other",
    getItemId: (req) => req.params.id,
  }),
  businessController.updateBusiness,
);

// DELETE business – admin only
router.delete(
  "/:id",
  protect,
  adminOnly,
  activityLogger({
    logType: "delete",
    itemType: "Event",
    module: "Other",
    getItemId: (req) => req.params.id,
  }),
  businessController.deleteBusiness,
);

module.exports = router;
