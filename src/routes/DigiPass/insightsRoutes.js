const express = require("express");
const router = express.Router();

const {
  getAvailableFields,
  getFieldDistribution,
  getTimeDistribution,
  getInsightsSummary,
  getScannedByTypeDistribution,
  getScannedByUserDistribution,
} = require("../../controllers/DigiPass/insightsController");

const { protect, checkPermission } = require("../../middlewares/auth");
const digiPassAccess = [protect, checkPermission.digipass];

// Get available fields for insights
router.get("/:slug/fields", digiPassAccess, getAvailableFields);

// Get field distribution for pie charts
router.get("/:slug/distribution", digiPassAccess, getFieldDistribution);

// Get time-based distribution for line charts
router.get("/:slug/time-distribution", digiPassAccess, getTimeDistribution);

// Get summary statistics
router.get("/:slug/summary", digiPassAccess, getInsightsSummary);

// Get scanned-by type distribution (desk vs door)
router.get("/:slug/scanned-by-type", digiPassAccess, getScannedByTypeDistribution);

// Get scanned-by user distribution (individual users)
router.get("/:slug/scanned-by-users", digiPassAccess, getScannedByUserDistribution);

module.exports = router;
