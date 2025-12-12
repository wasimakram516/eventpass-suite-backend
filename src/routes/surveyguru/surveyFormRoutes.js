const express = require("express");
const router = express.Router();

const { protect, checkPermission } = require("../../middlewares/auth");

const form = require("../../controllers/SurveyGuru/formController");

const access = [protect, checkPermission.surveyguru];

router.post("/forms", access, form.createForm);
router.get("/forms", access, form.listForms);
router.get("/forms/:id", access, form.getForm);
router.put("/forms/:id", access, form.updateForm);
router.delete("/forms/:id", access, form.deleteForm);

// Public
router.get("/forms/public/slug/:slug", form.getFormBySlug);

module.exports = router;
