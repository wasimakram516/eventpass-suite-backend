const express = require("express");
const router = express.Router();

const { protect, checkPermission } = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");

const form = require("../../controllers/SurveyGuru/formController");

const access = [protect, checkPermission.surveyguru];

// CMS (multipart for create/update so we can upload option images)
router.post("/forms", access, upload.any(), form.createForm);
router.get("/forms", access, form.listForms);
router.get("/forms/:id", access, form.getForm);
router.put("/forms/:id", access, upload.any(), form.updateForm);
router.delete("/forms/:id", access, form.deleteForm);

// Public
router.get("/forms/public/slug/:slug", form.getFormBySlug);

module.exports = router;
