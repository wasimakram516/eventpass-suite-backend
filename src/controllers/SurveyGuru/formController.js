const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");

const SurveyForm = require("../../models/SurveyForm");
const SurveyResponse = require("../../models/SurveyResponse");
const SurveyRecipient = require("../../models/SurveyRecipient");

const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { slugify, generateUniqueSlug } = require("../../utils/slugGenerator");

// ---------- helpers ----------
const parseJson = (v) => {
  if (v == null) return v;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

// accept fieldnames like optionImage[0][1] OR optionImage_0_1
const OPTION_IMG_RX_A = /^optionImage\[(\d+)\]\[(\d+)\]$/;
const OPTION_IMG_RX_B = /^optionImage_(\d+)_(\d+)$/;

async function attachOptionImages(questions = [], files = [], prevForm = null) {
  // Build lookup from fieldname -> {qi, oi}
  const fileMap = new Map();
  for (const f of files || []) {
    let m =
      f.fieldname.match(OPTION_IMG_RX_A) || f.fieldname.match(OPTION_IMG_RX_B);
    if (!m) continue;
    const qi = Number(m[1]);
    const oi = Number(m[2]);
    fileMap.set(`${qi}:${oi}`, f);
  }

  // Previous image urls for update flow (to support delete/replace)
  const prevImg = {};
  if (prevForm) {
    (prevForm.questions || []).forEach((q, qi) => {
      (q.options || []).forEach((o, oi) => {
        prevImg[`${qi}:${oi}`] = o?.imageUrl || null;
      });
    });
  }

  // Iterate questions/options and upload any provided file
  for (let qi = 0; qi < (questions || []).length; qi++) {
    const q = questions[qi] || {};
    q.options = q.options || [];
    for (let oi = 0; oi < q.options.length; oi++) {
      const key = `${qi}:${oi}`;
      const opt = q.options[oi] || {};
      const incomingRemoveFlag = !!opt.imageRemove;

      if (fileMap.has(key)) {
        const file = fileMap.get(key);
        const uploaded = await uploadToCloudinary(file.buffer, file.mimetype);
        const newUrl = uploaded.secure_url;

        if (prevForm && prevImg[key]) {
          await deleteImage(prevImg[key]);
        }
        opt.imageUrl = newUrl;
        delete opt.imageRemove;
      } else if (incomingRemoveFlag) {
        // explicit remove request (no file uploaded but user cleared image)
        if (prevForm && prevImg[key]) {
          await deleteImage(prevImg[key]);
        }
        opt.imageUrl = null;
        delete opt.imageRemove;
      } else if (!opt.imageUrl && prevForm && prevImg[key]) {
        // preserve previous image if not replaced/removed
        opt.imageUrl = prevImg[key];
      }

      q.options[oi] = opt;
    }
    questions[qi] = q;
  }
  return questions;
}

// ---------- controllers ----------

// CREATE FORM  (multipart/form-data)
exports.createForm = asyncHandler(async (req, res) => {
  const body = {
    businessId: req.body.businessId,
    eventId: req.body.eventId,
    slug: req.body.slug,
    title: req.body.title,
    description: req.body.description || "",
    isActive: String(req.body.isActive ?? "true") === "true",
    isAnonymous: String(req.body.isAnonymous ?? "false") === "true",
    questions: parseJson(req.body.questions) || [],
    defaultLanguage: req.body.defaultLanguage || "en",
  };

  if (!body.businessId) return response(res, 400, "businessId is required");
  if (!body.eventId) return response(res, 400, "eventId is required");
  if (!body.title) return response(res, 400, "title is required");

  // Sanitize or auto-generate slug
  let baseSlug = body.slug?.trim()
    ? slugify(body.slug)
    : slugify(body.title || "form");

  // Ensure slug is unique per business
  const existing = await SurveyForm.findOne({
    businessId: body.businessId,
    slug: baseSlug,
  }).collation({ locale: "en", strength: 2 });

  if (existing) {
    baseSlug = await generateUniqueSlug(
      SurveyForm,
      "slug",
      `${baseSlug}-${Date.now().toString().slice(-4)}`
    );
  }

  body.slug = baseSlug;

  // Attach option images from uploaded files
  body.questions = await attachOptionImages(
    body.questions,
    req.files || [],
    null
  );

  const form = await SurveyForm.create(body);

  // Fire background recompute
  recomputeAndEmit(body.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Survey form created", form);
});

// LIST FORMS (?businessId=&eventId=&withCounts=1)
exports.listForms = asyncHandler(async (req, res) => {
  const { businessId, eventId, withCounts } = req.query;
  const filter = {};
  if (businessId) filter.businessId = businessId;
  if (eventId) filter.eventId = eventId;

  const forms = await SurveyForm.find(filter)
    .notDeleted()
    .sort({ createdAt: -1 });

  if (withCounts) {
    const ids = forms.map((f) => f._id);
    const [respAgg, recAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: { formId: { $in: ids } } },
        { $group: { _id: "$formId", c: { $sum: 1 } } },
      ]),
      SurveyRecipient.aggregate([
        { $match: { formId: { $in: ids } } },
        { $group: { _id: "$formId", c: { $sum: 1 } } },
      ]),
    ]);
    const respMap = new Map(respAgg.map((x) => [String(x._id), x.c]));
    const recMap = new Map(recAgg.map((x) => [String(x._id), x.c]));
    return response(
      res,
      200,
      "Survey forms fetched",
      forms.map((f) => ({
        ...f.toObject(),
        responseCount: respMap.get(String(f._id)) || 0,
        recipientCount: recMap.get(String(f._id)) || 0,
      }))
    );
  }

  return response(res, 200, "Survey forms fetched", forms);
});

// GET FORM BY ID
exports.getForm = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return response(res, 400, "Invalid form id");
  const form = await SurveyForm.findById(id).notDeleted();
  if (!form) return response(res, 404, "Survey form not found");
  return response(res, 200, "Survey form fetched", form);
});

// PUBLIC: GET FORM BY SLUG (active only)
exports.getFormBySlug = asyncHandler(async (req, res) => {
  const form = await SurveyForm.findOne({
    slug: req.params.slug,
    isActive: true,
  }).notDeleted();
  if (!form) return response(res, 404, "Survey form not found");
  return response(res, 200, "Survey form fetched", form);
});

// UPDATE FORM  (multipart/form-data)
exports.updateForm = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return response(res, 400, "Invalid form id");

  const prev = await SurveyForm.findById(id).notDeleted();
  if (!prev) return response(res, 404, "Survey form not found");

  const patch = {
    businessId: req.body.businessId ?? prev.businessId,
    eventId: req.body.eventId ?? prev.eventId,
    slug: req.body.slug ?? prev.slug,
    title: req.body.title ?? prev.title,
    description: req.body.description ?? prev.description,
    isActive:
      typeof req.body.isActive === "undefined"
        ? prev.isActive
        : String(req.body.isActive) === "true",
    isAnonymous:
      typeof req.body.isAnonymous === "undefined"
        ? prev.isAnonymous
        : String(req.body.isAnonymous) === "true",
    questions: parseJson(req.body.questions) ?? prev.questions,
    defaultLanguage:
      typeof req.body.defaultLanguage === "undefined"
        ? prev.defaultLanguage
        : req.body.defaultLanguage,
  };

  // attach/replace/remove option images based on uploaded files + flags
  patch.questions = await attachOptionImages(
    patch.questions,
    req.files || [],
    prev
  );

  const updated = await SurveyForm.findByIdAndUpdate(id, patch, { new: true });

  // Fire background recompute
  recomputeAndEmit(updated.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Survey form updated", updated);
});

// Soft delete form
exports.deleteForm = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return response(res, 400, "Invalid form id");

  const form = await SurveyForm.findById(id);
  if (!form) return response(res, 404, "Survey form not found");

  await form.softDelete(req.user.id);

  // Fire background recompute
  recomputeAndEmit(form.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Survey form moved to recycle bin");
});

// Restore form
exports.restoreForm = asyncHandler(async (req, res) => {
  const form = await SurveyForm.findOneDeleted({ _id: req.params.id });
  if (!form) return response(res, 404, "Form not found in trash");

  await form.restore();

  // Fire background recompute
  recomputeAndEmit(form.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Survey form restored", form);
});

// Permanent delete form (with cascade)
exports.permanentDeleteForm = asyncHandler(async (req, res) => {
  const form = await SurveyForm.findOneDeleted({ _id: req.params.id });
  if (!form) return response(res, 404, "Form not found in trash");
  await cascadePermanentDeleteForm(form._id);

  for (const q of form.questions || []) {
    for (const o of q.options || []) {
      if (o?.imageUrl) {
        await deleteImage(o.imageUrl);
      }
    }
  }

  await form.deleteOne();

  // Fire background recompute
  recomputeAndEmit(form.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Survey form permanently deleted");
});

// Restore all forms
exports.restoreAllForms = asyncHandler(async (req, res) => {
  const forms = await SurveyForm.findDeleted();
  if (!forms.length) {
    return response(res, 404, "No survey forms found in trash to restore");
  }

  for (const form of forms) {
    await form.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${forms.length} survey forms`);
});

// Permanently delete all forms
exports.permanentDeleteAllForms = asyncHandler(async (req, res) => {
  const forms = await SurveyForm.findDeleted();
  if (!forms.length) {
    return response(res, 404, "No survey forms found in trash to delete");
  }

  for (const form of forms) {
    await cascadePermanentDeleteForm(form._id);

    for (const q of form.questions || []) {
      for (const o of q.options || []) {
        if (o?.imageUrl) {
          await deleteImage(o.imageUrl);
        }
      }
    }

    await form.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Permanently deleted ${forms.length} survey forms`);
});

// Helper function to cascade delete form data
async function cascadePermanentDeleteForm(formId) {
  await Promise.all([
    SurveyResponse.deleteMany({ formId }),
    SurveyRecipient.deleteMany({ formId }),
  ]);
}
