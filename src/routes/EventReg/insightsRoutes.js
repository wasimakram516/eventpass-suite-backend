const express = require("express");
const router = express.Router();

const {
  getAvailableFields,
  getFieldDistribution,
  getTimeDistribution,
  getInsightsSummary,
  getScannedByTypeDistribution,
  getScannedByUserDistribution,
} = require("../../controllers/EventReg/insightsController");

const { protect, checkPermission } = require("../../middlewares/auth");
const eventRegAccess = [protect, checkPermission.eventreg];

// Get available fields for insights
router.get("/:slug/fields", eventRegAccess, getAvailableFields);

// Get field distribution for pie charts
router.get("/:slug/distribution", eventRegAccess, getFieldDistribution);

// Get time-based distribution for line charts
router.get("/:slug/time-distribution", eventRegAccess, getTimeDistribution);

// Get summary statistics
router.get("/:slug/summary", eventRegAccess, getInsightsSummary);

// Get scanned-by type distribution (desk vs door)
router.get("/:slug/scanned-by-type", eventRegAccess, getScannedByTypeDistribution);

// Get scanned-by user distribution (individual users)
router.get("/:slug/scanned-by-users", eventRegAccess, getScannedByUserDistribution);


module.exports = router;