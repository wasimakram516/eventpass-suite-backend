const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUnassignedUsers,
} = require("../controllers/usersController");

const { protect, adminOnly } = require("../middlewares/auth");

router.use(protect);
router.get("/", adminOnly, getAllUsers);
router.get("/unassigned", adminOnly, getUnassignedUsers);
router.get("/:id", adminOnly, getUserById);
router.put("/:id", adminOnly, updateUser);
router.delete("/:id", adminOnly, deleteUser);

module.exports = router;
