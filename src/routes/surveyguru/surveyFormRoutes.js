const express = require("express");
const router = express.Router();

const { protect, checkPermission } = require("../../middlewares/auth");
const SurveyForm = require("../../models/SurveyForm");
const form = require("../../controllers/SurveyGuru/formController");
const activityLogger = require("../../middlewares/activityLogger");

const access = [protect, checkPermission.surveyguru];

const preFetchFormBusinessId = async (req) => {
  const doc = await SurveyForm.findById(req.params.id).select("businessId").lean();
  return doc?.businessId ?? null;
};

router.post(
  "/forms",
  access,
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "SurveyGuru",
  }),
  form.createForm,
);
router.get("/forms", access, form.listForms);
router.get("/forms/:id", access, form.getForm);
router.post(
  "/forms/:id/clone",
  access,
  activityLogger({
    logType: "create",
    itemType: "Event",
    module: "SurveyGuru",
  }),
  form.cloneForm,
);
router.put(
  "/forms/:id",
  access,
  activityLogger({
    logType: "update",
    itemType: "Event",
    module: "SurveyGuru",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchFormBusinessId,
  }),
  form.updateForm,
);
router.delete(
  "/forms/:id",
  access,
  activityLogger({
    logType: "delete",
    itemType: "Event",
    module: "SurveyGuru",
    getItemId: (req) => req.params.id,
    preFetchBusinessId: preFetchFormBusinessId,
  }),
  form.deleteForm,
);

// Public
router.get("/forms/public/slug/:slug", form.getFormBySlug);

module.exports = router;
