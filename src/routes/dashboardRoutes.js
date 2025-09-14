const express = require("express");
const router = express.Router();
const { getDashboardStats } = require("../controllers/dashboardController");
const { protect } = require("../middlewares/auth");

router.get("/insights", protect, getDashboardStats);

module.exports = router;
