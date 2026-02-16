const express = require("express");
const {
  registerUser,
  login,
  refreshToken,
  logout
} = require("../controllers/authController");
const { protect } = require("../middlewares/auth");
const activityLogger = require("../middlewares/activityLogger");

const router = express.Router();

// Public
router.post("/register", registerUser);
router.post(
  "/login",
  activityLogger({
    logType: "login",
    itemType: "Event",
    module: "Auth",
  }),
  login,
);
router.post("/refresh", refreshToken);

// Protected
router.post("/logout", protect, logout);

module.exports = router;
