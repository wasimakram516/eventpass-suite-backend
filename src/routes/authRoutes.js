const express = require("express");
const {
  registerBusinessUser,
  login,
  refreshToken,
  logout
} = require("../controllers/authController");
const { protect } = require("../middlewares/auth");

const router = express.Router();

// Public
router.post("/register", registerBusinessUser);
router.post("/login", login);
router.post("/refresh", refreshToken);

// Protected
router.post("/logout", protect, logout);

module.exports = router;
