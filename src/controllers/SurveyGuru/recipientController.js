const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const XLSX = require("xlsx");
const {
  pickEmail,
  pickFullName,
  pickCompany,
} = require("../../utils/customFieldUtils");

const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const SurveyForm = require("../../models/SurveyForm");
const SurveyRecipient = require("../../models/SurveyRecipient");
const env = require("../../config/env");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const {
  emitSurveyEmailProgress,
  emitSurveySyncProgress,
} = require("../../socket/modules/surveyguru/surveyGuruSocket");
const {
  buildSurveyInvitationEmail,
} = require("../../utils/surveyEmailTemplateBuilder");
const sendEmail = require("../../services/emailService");

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

  const totalRegs = regs.length;
  let processed = 0;
  let added = 0;
  let updated = 0;
  const seen = new Set();

  for (const reg of regs) {
    processed++;

    // Prefer custom fields over classic registration fields
    const email = (pickEmail(reg.customFields) || reg.email || "")
      .trim()
      .toLowerCase();

    if (!email || seen.has(email)) {
      emitSurveySyncProgress(form._id.toString(), processed, totalRegs);
      continue;
    }
    seen.add(email);

    const fullName =
      pickFullName(reg.customFields) ||
      reg.fullName ||
      [reg.firstName, reg.lastName].filter(Boolean).join(" ") ||
      "";

    const company = pickCompany(reg.customFields) || reg.company || "";
    const token = reg.token || "";

    // Build upsert document safely (avoid conflicting operators)
    const updateDoc = {
      $setOnInsert: {
        formId: form._id,
        businessId: form.businessId,
        eventId: form.eventId,
        email,
        status: "queued",
      },
      $set: {},
    };

    if (fullName) updateDoc.$set.fullName = fullName;
    if (company) updateDoc.$set.company = company;
    if (token) updateDoc.$set.token = token;

    try {
      const result = await SurveyRecipient.findOneAndUpdate(
        { formId: form._id, email },
        updateDoc,
        {
          upsert: true,
          new: false,
          collation: { locale: "en", strength: 2 },
        }
      );

      if (!result) added++;
      else updated++;
    } catch (err) {
      console.error(`Sync error for ${email}:`, err.message);
    }

    // Emit real-time sync progress
    emitSurveySyncProgress(form._id.toString(), processed, totalRegs);
  }

  // Emit final 100% progress
  emitSurveySyncProgress(form._id.toString(), totalRegs, totalRegs);

  // Trigger dashboard recompute (non-blocking)
  recomputeAndEmit(form.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  // Final response
  return response(
    res,
    200,
    `Recipient sync completed — ${added} added, ${updated} updated, out of ${totalRegs} total (${seen.size} unique emails).`,
    {
      eventName: event.name,
      added,
      updated,
      scanned: totalRegs,
      uniqueEmails: seen.size,
    }
  );
});

// Send Bulk Emails to survey recipients
exports.sendBulkSurveyEmails = asyncHandler(async (req, res) => {
  const { formId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  // Fetch form + linked event
  const form = await SurveyForm.findById(formId).populate("eventId").lean();
  if (!form) return response(res, 404, "Form not found");

  const event = await Event.findById(form.eventId).lean();
  if (!event) return response(res, 404, "Event not found");

  // Find queued recipients
  const pendingRecipients = await SurveyRecipient.find({
    formId,
    status: "queued",
  }).lean();

  if (!pendingRecipients.length)
    return response(res, 200, "All survey emails already sent.");

  const total = pendingRecipients.length;
  let processed = 0;
  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of pendingRecipients) {
    processed++;

    try {
      // Try to find matching registration (for custom fields)
      const reg = await Registration.findOne({
        eventId: form.eventId,
        email: recipient.email,
      })
        .select("customFields fullName email phone company")
        .lean();

      // normalize custom fields
      let cf = {};
      if (reg?.customFields) {
        if (Array.isArray(reg.customFields)) {
          cf = Object.fromEntries(reg.customFields);
        } else if (typeof reg.customFields === "object") {
          cf = reg.customFields;
        }
      }

      // Build display name
      const displayName =
        recipient.fullName ||
        reg?.fullName ||
        (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

      // Generate email content
      const { subject, html } = await buildSurveyInvitationEmail({
        event,
        form,
        recipient,
        registration: {
          ...reg,
          customFields: cf,
        },
        displayName,
      });

      // Send email
      const result = await sendEmail(recipient.email, subject, html);

      if (result.success) {
        await SurveyRecipient.updateOne(
          { _id: recipient._id },
          { $set: { status: "responded" } }
        );
        sentCount++;
        console.log(`Survey email sent to ${recipient.email}`);
      } else {
        console.warn(
          `Failed to send survey email to ${recipient.email}: ${
            result.response || result.error
          }`
        );
        failedCount++;
      }
    } catch (err) {
      console.error("Survey email error:", err.message);
      failedCount++;
    }

    emitSurveyEmailProgress(form._id.toString(), processed, total);
  }

  // Final emission
  emitSurveyEmailProgress(form._id.toString(), total, total);

  return response(
    res,
    200,
    `Bulk survey emails completed — ${sentCount} sent, ${failedCount} failed, out of ${total} total.`,
    {
      sent: sentCount,
      failed: failedCount,
      total,
    }
  );
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

  const formatLocalLong = (date) => {
    if (!date) return "";
    const d = new Date(date);

    const datePart = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const timePart = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    return `${datePart} at ${timePart}`;
  };

  // Prepare rows for Excel
  const allRecipientData = recipients.map((r) => ({
    "Full Name": r.fullName || "",
    Email: r.email || "",
    Company: r.company || "",
    Status: r.status || "",
    Token: r.token || "",
    "Responded At": r.respondedAt ? formatLocalLong(r.respondedAt) : "",
    "Survey Link": `${base}${publicPath}/${
      form.slug
    }?token=${encodeURIComponent(r.token)}`,
    "Created At": r.createdAt ? formatLocalLong(r.createdAt) : "",
  }));

  // Summary sheet content
  const summary = [
    ["Business Name", form.businessId?.name || "-"],
    ["Event Name", form.eventId?.name || "-"],
    ["Form Title", form.title || "-"],
    ["Form Slug", form.slug],
    ["Total Recipients", recipients.length],
    ["Exported At", formatLocalLong(new Date())],
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
