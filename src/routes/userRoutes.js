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

router.use(protect);

router.post(
  "/register/staff",
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "Auth",
  }),
  registerUser,
); // REGISTER STAFF USER FOR A BUSINESS
router.post(
  "/register/business",
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "Auth",
  }),
  createBusinessUser,
); // REGISTER BUSINESS USER FOR A BUSINESS
router.post(
  "/register/admin",
  superAdminOnly,
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "Auth",
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
    itemType: "Event",
    module: "Auth",
    getItemId: (req) => req.params.id,
  }),
  updateUser,
);
router.delete(
  "/:id",
  activityLogger({
    logType: "delete",
    itemType: "Event",
    module: "Auth",
    getItemId: (req) => req.params.id,
  }),
  deleteUser,
);

module.exports = router;
