const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  getAllStaffUsersByBusiness,
  getUserById,
  updateUser,
  deleteUser,
  getUnassignedUsers,
} = require("../controllers/usersController");
const { registerUser } = require("../controllers/authController");

const { protect, adminOnly } = require("../middlewares/auth");

router.use(protect);

router.post("/register/staff", registerUser); // REGISTER STAFF USER FOR A BUSINESS
router.get("/:businessId/staff", getAllStaffUsersByBusiness); // GET all users of a specific business

router.get("/unassigned", adminOnly, getUnassignedUsers);
router.get("/", getAllUsers);
router.get("/:id", getUserById);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

module.exports = router;
