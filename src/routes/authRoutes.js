const express = require("express");
const {
  registerUser,
  login,
  refreshToken,
  logout
} = require("../controllers/authController");
const { protect } = require("../middlewares/auth");

const router = express.Router();

// Public
router.post("/register", registerUser);
router.post("/login", login);
router.post("/refresh", refreshToken);

// Protected
router.post("/logout", protect, logout);

module.exports = router;
