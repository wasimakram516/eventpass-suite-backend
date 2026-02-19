const XLSX = require("xlsx");
const mongoose = require("mongoose");
const env = require("../../config/env");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const SurveyForm = require("../../models/SurveyForm");
const SurveyRecipient = require("../../models/SurveyRecipient");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const {
  emitSurveyEmailProgress,
} = require("../../socket/modules/surveyguru/surveyGuruSocket");

const loadRemainingRecipients = require("../../processors/surveyguru/syncRecipientsProcessor");
const processBulkEmails = require("../../processors/surveyguru/emailProcessor");

// Sync recipients from event registrations
exports.syncFromEventRegistrations = asyncHandler(async (req, res) => {
  const { formId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  const form = await SurveyForm.findById(formId)
    .select("_id eventId businessId")
    .lean();

  if (!form) return response(res, 404, "Form not found");

  const regs = await Registration.find({ eventId: form.eventId })
    .select("email fullName company token customFields eventId")
    .lean();

  response(res, 200, "Sync started");

  const logContext = {
    userId: req.user?.id ?? req.user?._id ?? null,
    businessId: form.businessId || null,
  };

  setImmediate(() => {
    loadRemainingRecipients(formId, regs, 100, logContext).catch((err) =>
      console.error("Survey sync failed:", err)
    );
  });
});

// Get paginated list of recipients for a survey form
exports.listRecipients = asyncHandler(async (req, res) => {
  const { formId, q = "", status = "", page = 1, limit = 20 } = req.query;

  if (!formId || !mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Valid formId is required");
  }

  const _page = Math.max(1, Number(page));
  const _limit = Math.min(200, Number(limit));

  const match = { formId };

  // Optional status filter
  if (status?.trim()) {
    match.status = status.trim().toLowerCase(); // queued | responded
  }

  // Optional search filter
  const qTrim = String(q || "").trim();
  if (qTrim) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escape(qTrim), "i");
    match.$or = [{ fullName: rx }, { email: rx }, { company: rx }];
  }

  // Count total documents (fast because indexed)
  const total = await SurveyRecipient.countDocuments(match);

  // Fetch paginated recipients
  const recipients = await SurveyRecipient.find(match)
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ createdAt: -1 })
    .skip((_page - 1) * _limit)
    .limit(_limit)
    .lean();

  return response(res, 200, "Recipients fetched", {
    recipients,
    pagination: {
      page: _page,
      limit: _limit,
      total,
      totalPages: Math.ceil(total / _limit),
    },
  });
});

// Send Bulk Emails to survey recipients
exports.sendBulkSurveyEmails = asyncHandler(async (req, res) => {
  const { formId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  const form = await SurveyForm.findById(formId).populate("eventId").lean();
  if (!form) return response(res, 404, "Form not found");

  const event = await Event.findById(form.eventId).lean();
  if (!event) return response(res, 404, "Event not found");

  const pendingRecipients = await SurveyRecipient.find({
    formId,
    status: "queued",
  }).lean();

  if (!pendingRecipients.length) {
    // Emit a 100% completion event so frontend resets state
    emitSurveyEmailProgress(formId, {
      sent: 0,
      failed: 0,
      processed: 0,
      total: 0,
    });

    return response(res, 200, "All survey emails already sent.");
  }

  response(res, 200, "Bulk email job started");

  setImmediate(() => {
    processBulkEmails(form, event, pendingRecipients).catch((err) =>
      console.error("Bulk email job failed:", err)
    );
  });
});

// DELETE /surveyguru/recipients/:id
exports.deleteRecipient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return response(res, 400, "Invalid recipient id");
  const rec = await SurveyRecipient.findById(id);
  if (!rec) return response(res, 404, "Recipient not found");
  await rec.deleteOne();
  return response(res, 200, "Recipient deleted");
});

// DELETE /surveyguru/forms/:formId/recipients
exports.clearRecipients = asyncHandler(async (req, res) => {
  const { formId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(formId))
    return response(res, 400, "Invalid formId");
  const result = await SurveyRecipient.deleteMany({ formId });

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "All recipients cleared", {
    deleted: result.deletedCount || 0,
  });
});

// GET /surveyguru/recipients/export?formId=...&timezone=...
exports.exportRecipients = asyncHandler(async (req, res) => {
  const { formId, timezone } = req.query;
  if (!formId || !mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  const form = await SurveyForm.findById(formId)
    .populate("businessId", "name")
    .populate("eventId", "name")
    .select("_id slug title businessId eventId isAnonymous defaultLanguage")
    .lean();
  if (!form) return response(res, 404, "Form not found");

  const recipients = await SurveyRecipient.find({ formId })
    .select("fullName email company status token respondedAt createdAt")
    .sort({ createdAt: -1 })
    .lean();

  if (!recipients.length) {
    return response(res, 404, "No recipients found for this form");
  }

  const base = env.client.url;
  const publicPath = env.client.surveyGuru;

  const formatLocalLong = (date) => {
    if (!date) return "";
    const d = new Date(date);

    const dateOptions = {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    };

    const timeOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    };

    const datePart = timezone
      ? new Intl.DateTimeFormat("en-US", {
          ...dateOptions,
          timeZone: timezone,
        }).format(d)
      : d.toLocaleDateString("en-US", dateOptions);

    const timePart = timezone
      ? new Intl.DateTimeFormat("en-US", {
          ...timeOptions,
          timeZone: timezone,
        }).format(d)
      : d.toLocaleTimeString("en-US", timeOptions);

    return `${datePart} at ${timePart}`;
  };

  // ----- Build rows for Excel -----
  const allRecipientData = recipients.map((r) => {
    const isAnon = form.isAnonymous;

    const targetLang = form.defaultLanguage || "en";

    const surveyLink = isAnon
      ? `${base}${publicPath}/${targetLang}/${form.slug}`
      : `${base}${publicPath}/${targetLang}/${form.slug
      }?token=${encodeURIComponent(r.token)}`;

    return {
      "Full Name": isAnon ? "Anonymous" : r.fullName || "",
      Email: isAnon ? "" : r.email || "",
      Company: isAnon ? "" : r.company || "",
      Status: r.status || "",
      Token: isAnon ? "" : r.token || "",
      "Responded At": r.respondedAt ? formatLocalLong(r.respondedAt) : "",
      "Survey Link": surveyLink,
      "Created At": r.createdAt ? formatLocalLong(r.createdAt) : "",
    };
  });

  // ----- Summary sheet -----
  const summary = [
    ["Business Name", form.businessId?.name || "-"],
    ["Event Name", form.eventId?.name || "-"],
    ["Form Title", form.title || "-"],
    ["Form Slug", form.slug],
    ["Total Recipients", recipients.length],
    ["Anonymous Form", form.isAnonymous ? "Yes" : "No"],
    form.isAnonymous
      ? [
        "Note",
        "This is an anonymous survey. Personal details are not collected.",
      ]
      : [],
    ["Exported At", formatLocalLong(new Date())],
    [], // blank row before table
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.sheet_add_json(summarySheet, allRecipientData, { origin: -1 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Recipients");

  const sanitizeFilename = (name) =>
    name ? name.replace(/[^\w\u0600-\u06FF-]/g, "_") : "file";

  const safeCompany = sanitizeFilename(form.businessId?.name || "company");
  const safeForm = sanitizeFilename(form.title || form.slug);
  const filename = `${safeCompany}-${safeForm}-recipients.xlsx`;

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8"
  );

  return res.send(buffer);
});
