const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const XLSX = require("xlsx");

const SurveyResponse = require("../../models/SurveyResponse");
const SurveyRecipient = require("../../models/SurveyRecipient");
const SurveyForm = require("../../models/SurveyForm");

// PUBLIC: submit response by slug, optional ?token= to link a recipient
exports.submitResponseBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { token } = req.query;
  const payload = req.body || {};

  const form = await SurveyForm.findOne({ slug, isActive: true });
  if (!form) return response(res, 404, "Form unavailable");

  let recipient = null;
  if (token) {
    recipient = await SurveyRecipient.findOne({ formId: form._id, token });
  }

  const saved = await SurveyResponse.create({
    formId: form._id,
    recipientId: recipient?._id || null,
    attendee: payload.attendee,
    answers: payload.answers,
    submittedAt: new Date(),
  });

  if (recipient && recipient.status !== "responded") {
    recipient.status = "responded";
    recipient.respondedAt = new Date();
    await recipient.save();
  }

  return response(res, 201, "Survey response submitted", { _id: saved._id });
});

// CMS: list responses for a form (with recipient details)
exports.listResponsesByForm = asyncHandler(async (req, res) => {
  const { formId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  const rows = await SurveyResponse.find({ formId })
    .populate("recipientId", "fullName email company status token respondedAt createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return response(res, 200, "Survey responses fetched", rows);
});

// CMS: Export responses Excel for a form (with recipient details if linked)
exports.exportResponsesCsv = asyncHandler(async (req, res) => {
  const { formId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(formId)) {
    return response(res, 400, "Invalid formId");
  }

  const form = await SurveyForm.findById(formId)
    .populate("businessId", "name")
    .populate("eventId", "name")
    .lean();
  if (!form) return response(res, 404, "Form not found");

  const optLabel = new Map();
  (form.questions || []).forEach((q) => {
    (q.options || []).forEach((o) => {
      optLabel.set(String(o._id), o.label || "");
    });
  });

  // Fetch responses with recipient info populated
  const rowsRaw = await SurveyResponse.find({ formId })
    .populate("recipientId", "fullName email company status token respondedAt createdAt")
    .sort({ createdAt: 1 })
    .lean();

  if (!rowsRaw.length) {
    return response(res, 404, "No responses found for this form");
  }

  // Prepare rows for Excel
  const allResponseData = rowsRaw.map((r) => {
    const row = {
      // Actual submitted attendee info
      "Attendee Name": r.attendee?.name || "",
      "Attendee Email": r.attendee?.email || "",
      "Attendee Company": r.attendee?.company || "",
      "Submitted At": r.submittedAt ? new Date(r.submittedAt).toISOString() : "",
    };

    // Original recipient info (if available)
    if (r.recipientId) {
      row["Original Full Name"] = r.recipientId.fullName || "";
      row["Original Email"] = r.recipientId.email || "";
      row["Original Company"] = r.recipientId.company || "";
      row["Recipient Status"] = r.recipientId.status || "";
      row["Recipient Token"] = r.recipientId.token || "";
      row["Recipient Created At"] = r.recipientId.createdAt
        ? new Date(r.recipientId.createdAt).toISOString()
        : "";
      row["Recipient Responded At"] = r.recipientId.respondedAt
        ? new Date(r.recipientId.respondedAt).toISOString()
        : "";
    } else {
      row["Original Full Name"] = "";
      row["Original Email"] = "";
      row["Original Company"] = "";
      row["Recipient Status"] = "";
      row["Recipient Token"] = "";
      row["Recipient Created At"] = "";
      row["Recipient Responded At"] = "";
    }

    // Fill in answers for each question
    (form.questions || []).forEach((q, idx) => {
      const ans = (r.answers || []).find(
        (a) => String(a.questionId) === String(q._id)
      );
      let val = "";
      if (ans) {
        if (Array.isArray(ans.optionIds) && ans.optionIds.length) {
          val = ans.optionIds
            .map((id) => optLabel.get(String(id)) || "")
            .join(" | ");
        } else if (typeof ans.text === "string" && ans.text.length) {
          val = ans.text;
        } else if (typeof ans.number === "number") {
          val = String(ans.number);
        }
      }
      const headerLabel = (q.label || `Q${idx + 1}`).replace(/\s+/g, " ").trim();
      row[headerLabel] = val;
    });

    return row;
  });

  // Summary sheet content
  const summary = [
    ["Business Name", form.businessId?.name || "-"],
    ["Event Name", form.eventId?.name || "-"],
    ["Form Title", form.title || "-"],
    ["Form Slug", form.slug],
    ["Total Responses", rowsRaw.length],
    ["Exported At", new Date().toISOString()],
    [], // blank row before table
  ];

  // Build workbook
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.sheet_add_json(summarySheet, allResponseData, { origin: -1 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Responses");

  // Sanitize filename
  const sanitizeFilename = (name) =>
    name ? name.replace(/[^\w\u0600-\u06FF-]/g, "_") : "file";
  const safeCompany = sanitizeFilename(form.businessId?.name || "company");
  const safeForm = sanitizeFilename(form.title || form.slug);
  const filename = `${safeCompany}-${safeForm}-responses.xlsx`;

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
