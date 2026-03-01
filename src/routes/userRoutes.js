const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  getAllStaffUsersByBusiness,
  getUserById,
  updateUser,
  deleteUser,
  getUnassignedUsers,
  createBusinessUser,
  createAdminUser,
} = require("../controllers/usersController");
const { registerUser } = require("../controllers/authController");

const { protect, adminOnly, superAdminOnly } = require("../middlewares/auth");
const activityLogger = require("../middlewares/activityLogger");
const User = require("../models/User");

router.use(protect);

router.post(
  "/register/staff",
  activityLogger({
    logType: "create",
    itemType: "User",
    module: "User",
    getItemName: (_req, data) => data?.user?.name || data?.user?.email || null,
  }),
  registerUser,
); // REGISTER STAFF USER FOR A BUSINESS
router.post(
  "/register/business",
  activityLogger({
    logType: "create",
    itemType: "User",
    module: "User",
    getItemName: (_req, data) => data?.user?.name || data?.user?.email || null,
  }),
  createBusinessUser,
); // REGISTER BUSINESS USER FOR A BUSINESS
router.post(
  "/register/admin",
  superAdminOnly,
  activityLogger({
    logType: "create",
    itemType: "User",
    module: "User",
    getItemName: (_req, data) => data?.user?.name || data?.user?.email || null,
  }),
  createAdminUser,
); // CREATE ADMIN USER (SUPERADMIN ONLY)

router.get("/:businessId/staff", getAllStaffUsersByBusiness); // GET all users of a specific business
router.get("/unassigned", adminOnly, getUnassignedUsers);
router.get("/", getAllUsers);
router.get("/:id", getUserById);
router.put(
  "/:id",
  activityLogger({
    logType: "update",
    itemType: "User",
    module: "User",
    getItemId: (req) => req.params.id,
    getItemName: (_req, data) => data?.user?.name || data?.user?.email || data?.name || data?.email || null,
  }),
  updateUser,
);
router.delete(
  "/:id",
  activityLogger({
    logType: "delete",
    itemType: "User",
    module: "User",
    getItemId: (req) => req.params.id,
    getItemName: (_req, data) => data?.name || data?.email || null,
    preFetchBusinessId: async (req) => {
      const user = await User.findById(req.params.id).select("business").lean();
      return user?.business ?? null;
    },
  }),
  deleteUser,
);

module.exports = router;
