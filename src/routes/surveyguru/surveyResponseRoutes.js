const express = require("express");
const router = express.Router();

const { protect, checkPermission } = require("../../middlewares/auth");
const responseCtrl = require("../../controllers/SurveyGuru/responseController");

// Public submit (by slug, optional ?token=)
router.post("/forms/public/slug/:slug/submit", responseCtrl.submitResponseBySlug);

// CMS
const access = [protect, checkPermission.surveyguru];
router.get("/forms/:formId/responses", access, responseCtrl.listResponsesByForm);
router.get("/forms/:formId/responses/export", access, responseCtrl.exportResponsesCsv);

module.exports = router;
