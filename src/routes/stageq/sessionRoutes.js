const express = require("express");
const router = express.Router();
const sessionController = require("../../controllers/stageq/sessionController");
const sessionInsightsController = require("../../controllers/stageq/sessionInsightsController");
const { protect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const StageQSession = require("../../models/StageQSession");

const stageqAccess = [protect, checkPermission.stageq];

const preFetchSessionBusinessId = async (req) => {
  const session = await StageQSession.findById(req.params.id).select("business").lean();
  return session?.business ?? null;
};

// Insights (protected)
router.get("/insights/:slug/summary", stageqAccess, sessionInsightsController.getSummary);
router.get("/insights/:slug/fields", stageqAccess, sessionInsightsController.getAvailableFields);
router.get("/insights/:slug/distribution", stageqAccess, sessionInsightsController.getFieldDistribution);
router.get("/insights/:slug/time-distribution", stageqAccess, sessionInsightsController.getTimeDistribution);

// GET all sessions (protected)
router.get("/", stageqAccess, sessionController.getSessions);

// POST create session (protected)
router.post(
  "/",
  stageqAccess,
  activityLogger({ logType: "create", itemType: "Session", module: "StageQ" }),
  sessionController.createSession
);

// PUT update session (protected)
router.put(
  "/:id",
  stageqAccess,
  activityLogger({
    logType: "update",
    itemType: "Session",
    module: "StageQ",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchSessionBusinessId,
  }),
  sessionController.updateSession
);

// DELETE session (protected)
router.delete(
  "/:id",
  stageqAccess,
  activityLogger({
    logType: "delete",
    itemType: "Session",
    module: "StageQ",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchSessionBusinessId,
  }),
  sessionController.deleteSession
);

// PUBLIC: get session by slug
router.get("/slug/:slug", sessionController.getSessionBySlug);

// PUBLIC: verify attendee by session slug
router.post("/:slug/verify", sessionController.verifyAttendeeBySession);

module.exports = router;
