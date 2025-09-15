const express = require("express");
const { getDashboardStats, recalcDashboardStats } = require("../controllers/dashboardController");
const { protect } = require("../middlewares/auth");

const router = express.Router();

// Fetch precomputed metrics
router.get("/", protect, getDashboardStats);

// Force recalc
router.get("/recalc", protect, recalcDashboardStats);

module.exports = router;
