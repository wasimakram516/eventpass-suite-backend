const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const XLSX = require("xlsx");
const { pickEmail, pickFullName, pickCompany } = require("../../utils/customFieldUtils");

const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const SurveyForm = require("../../models/SurveyForm");
const SurveyRecipient = require("../../models/SurveyRecipient");
const env = require("../../config/env");

// recipientController.js
exports.listRecipients = asyncHandler(async (req, res) => {
  const { formId, q = "", status = "" } = req.query;

  if (!formId || !mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Valid formId is required");
  }

  const match = { formId };

  // optional status filter
  if (typeof status === "string" && status.trim()) {
    match.status = status.trim().toLowerCase(); // e.g., "queued" | "responded"
  }

  const qTrim = String(q || "").trim();
  if (qTrim) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(escape(qTrim), "i");
    match.$or = [{ fullName: rx }, { email: rx }, { company: rx }];
  }

  const recipients = await SurveyRecipient.find(match)
    .sort({ createdAt: -1 })
    .lean();

  return response(res, 200, "Recipients fetched", recipients);
});

// Pull all registrations for a form's eventId and save/update recipients
exports.syncFromEventRegistrations = asyncHandler(async (req, res) => {
  const { formId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  // Ensure form exists
  const form = await SurveyForm.findById(formId)
    .select("_id businessId eventId")
    .lean();
  if (!form) return response(res, 404, "Form not found");
  if (!form.eventId) return response(res, 400, "Form is missing eventId");

  // Ensure event exists
  const event = await Event.findById(form.eventId).select("_id name").lean();
  if (!event) return response(res, 404, "Event not found");

  // Pull all event registrations
  const regs = await Registration.find({ eventId: form.eventId })
    .select("token email fullName firstName lastName company customFields")
    .lean();

  let added = 0;
  let updated = 0;
  const seen = new Set();

  for (const reg of regs) {
    const email =
      (reg.email || "").trim().toLowerCase() ||
      (pickEmail(reg.customFields) || "").trim().toLowerCase();

    if (!email || seen.has(email)) continue;
    seen.add(email);

    const fullName =
      reg.fullName ||
      [reg.firstName, reg.lastName].filter(Boolean).join(" ") ||
      pickFullName(reg.customFields) ||
      "";

    const company =
      reg.company ||
      pickCompany(reg.customFields) ||
      "";

    const token = reg.token || "";

    // Recipient is keyed by (formId, email)
    const existing = await SurveyRecipient.findOne({
      formId: form._id,
      email,
    }).collation({ locale: "en", strength: 2 });

    if (!existing) {
      await SurveyRecipient.create({
        formId: form._id,
        businessId: form.businessId,
        eventId: form.eventId,
        email,
        fullName,
        company,
        token,
        status: "queued",
      });
      added++;
    } else {
      const patch = {};
      if (!existing.fullName && fullName) patch.fullName = fullName;
      if (!existing.company && company) patch.company = company;
      if (!existing.token && token) patch.token = token;

      if (Object.keys(patch).length) {
        await SurveyRecipient.updateOne({ _id: existing._id }, { $set: patch });
        updated++;
      }
    }
  }

  return response(res, 200, "Sync complete", {
    eventName: event.name,
    added,
    updated,
    scanned: regs.length,
    uniqueEmails: seen.size,
  });
});

// DELETE /surveyguru/recipients/:id
exports.deleteRecipient = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return response(res, 400, "Invalid recipient id");
  const rec = await SurveyRecipient.findById(id);
  if (!rec) return response(res, 404, "Recipient not found");
  await rec.deleteOne();
  return response(res, 200, "Recipient deleted");
});

// DELETE /surveyguru/forms/:formId/recipients
exports.clearRecipients = asyncHandler(async (req, res) => {
  const { formId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(formId)) return response(res, 400, "Invalid formId");
  const result = await SurveyRecipient.deleteMany({ formId });
  return response(res, 200, "All recipients cleared", { deleted: result.deletedCount || 0 });
});

// GET /surveyguru/recipients/export?formId=...
exports.exportRecipients = asyncHandler(async (req, res) => {
  const { formId } = req.query;
  if (!formId || !mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  const form = await SurveyForm.findById(formId)
    .populate("businessId", "name")
    .populate("eventId", "name")
    .select("_id slug title businessId eventId")
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

  // Prepare rows for Excel
  const allRecipientData = recipients.map((r) => ({
    "Full Name": r.fullName || "",
    "Email": r.email || "",
    "Company": r.company || "",
    "Status": r.status || "",
    "Token": r.token || "",
    "Responded At": r.respondedAt
      ? new Date(r.respondedAt).toISOString()
      : "",
    "Survey Link": `${base}${publicPath}/${form.slug}?token=${encodeURIComponent(
      r.token
    )}`,
    "Created At": r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  // Summary sheet content
  const summary = [
    ["Business Name", form.businessId?.name || "-"],
    ["Event Name", form.eventId?.name || "-"],
    ["Form Title", form.title || "-"],
    ["Form Slug", form.slug],
    ["Total Recipients", recipients.length],
    ["Exported At", new Date().toISOString()],
    [], // blank row before table
  ];

  // Build workbook
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.sheet_add_json(summarySheet, allRecipientData, { origin: -1 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Recipients");

  // Sanitize filename
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
