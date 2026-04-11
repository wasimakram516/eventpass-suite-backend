const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");
const Metrics = require("../models/DashboardMetrics");
const { recalcMetrics } = require("../services/statsService");

/**
 * GET /api/dashboard
 * Fetch precomputed metrics for superadmin or business
 */
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.role === "admin" || req.user.role === "superadmin";
  const scope = isAdmin ? "superadmin" : "business";
  const businessId = isAdmin ? null : req.user.business;

  let metrics = await Metrics.findOne({ scope, businessId });

  if (!metrics) {
    // Cache miss — warm-up hasn't run yet for this scope, compute on demand
    const fresh = await recalcMetrics(scope, businessId);
    return response(res, 200, "Fetched dashboard metrics", {
      scope: fresh.scope,
      modules: fresh.modules,
      lastUpdated: fresh.lastUpdated,
    });
  }

  return response(res, 200, "Fetched dashboard metrics", {
    scope,
    modules: metrics.modules,
    lastUpdated: metrics.lastUpdated,
  });
});

/**
 * GET /api/dashboard/recalc
 * Force refresh metrics for superadmin or business
 */
exports.recalcDashboardStats = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.role === "admin" || req.user.role === "superadmin";
  const scope = isAdmin ? "superadmin" : "business";
  const businessId = isAdmin ? null : req.user.business;

  const metrics = await recalcMetrics(scope, businessId);

  return response(res, 200, "Metrics recalculated successfully", metrics);
});
