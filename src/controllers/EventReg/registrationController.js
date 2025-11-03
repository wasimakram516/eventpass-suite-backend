const mongoose = require("mongoose");
const XLSX = require("xlsx");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const QRCode = require("qrcode");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const sendEmail = require("../../services/emailService");
const {
  pickFullName,
  pickEmail,
  pickPhone,
  pickCompany,
  pickTitle,
  pickBadgeIdentifier,
} = require("../../utils/customFieldUtils");
const { buildBadgeZpl } = require("../../utils/zebraZpl");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const {
  emitUploadProgress,
  emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");
const e = require("express");

const { buildRegistrationEmail } = require("../../utils/emailTemplateBuilder");

// DOWNLOAD sample Excel template
exports.downloadSampleExcel = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  let headers = [];
  if (event.formFields && event.formFields.length > 0) {
    headers = event.formFields.map((f) => f.inputName);
  } else {
    headers = ["Full Name", "Email", "Phone", "Company"];
  }
  headers.push("Token");

  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Registrations");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${slug}_registrations_template.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(buffer);
});

// BULK UPLOAD registrations
exports.uploadRegistrations = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  if (!slug) return response(res, 400, "Event Slug is required");

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  if (!req.file) return response(res, 400, "Excel file is required");

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "", // keep empty cells as empty string
  });

  if (!rows.length) {
    return response(res, 400, "Uploaded file is empty");
  }

  // Validate headers
  const headerRow = Object.keys(rows[0]);
  const expectedHeaders = [
    ...event.formFields.map((f) => f.inputName),
    "Token",
  ];

  const missingHeaders = expectedHeaders.filter((h) => !headerRow.includes(h));

  if (missingHeaders.length > 0) {
    return response(
      res,
      400,
      `Invalid Excel format. Missing or misspelled columns: ${missingHeaders.join(
        ", "
      )}`
    );
  }

  const results = [];
  const warnings = [];

  for (const [index, row] of rows.entries()) {
    try {
      const customFields = {};
      let missingField = null;

      for (const field of event.formFields) {
        const value = row[field.inputName];
        if (field.required && (!value || value === "")) {
          missingField = field.inputName;
          break;
        }
        if (value) {
          customFields[field.inputName] = value;
        }
      }

      if (missingField) {
        warnings.push(
          `Row ${index + 2} skipped: Missing required field "${missingField}"`
        );
        continue;
      }

      const reg = new Registration({
        eventId: event._id,
        customFields,
        token: row["Token"], // schema hook handles null/duplicate
      });

      await reg.save();
      results.push(reg);

      // Emit progress after each record
      emitUploadProgress(event._id.toString(), results.length, rows.length);
    } catch (err) {
      warnings.push(`Row ${index + 2} skipped: ${err.message}`);
    }
  }

  // Recount registrations for this event
  const totalRegs = await Registration.countDocuments({
    eventId: event._id,
  }).notDeleted();

  // Update event.registrations
  event.registrations = totalRegs;
  await event.save();

  // Emit final 100% progress
  emitUploadProgress(event._id.toString(), rows.length, rows.length);

  // Trigger recompute for dashboards
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Upload completed", {
    imported: results.length,
    skipped: warnings.length,
    totalRegistrations: totalRegs,
    warnings,
  });
});

// CREATE public registration
exports.createRegistration = asyncHandler(async (req, res) => {
  const { slug } = req.body;
  if (!slug) return response(res, 400, "Event slug is required");

  const event = await Event.findOne({ slug });
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public")
    return response(res, 400, "This event is not open for public registration");

  const now = new Date();
  const endOfDay = new Date(event.endDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  if (event.endDate && now > endOfDay) {
    return response(
      res,
      400,
      "Registration is closed. This event has already ended."
    );
  }

  if (event.registrations >= event.capacity)
    return response(res, 400, "Event capacity is full");

  const eventId = event._id;
  const formFields = event.formFields || [];
  const customFields = {};

  // --- Process dynamic custom fields ---
  if (formFields.length > 0) {
    for (const field of formFields) {
      const value = req.body[field.inputName];
      if (field.required && (value == null || value === "")) {
        return response(res, 400, `Missing required field: ${field.inputName}`);
      }
      if (
        ["radio", "list"].includes(field.inputType) &&
        value &&
        !field.values.includes(value)
      ) {
        return response(
          res,
          400,
          `Invalid value for ${field.inputName}. Allowed: ${field.values.join(
            ", "
          )}`
        );
      }
      if (value != null) {
        if (field.inputType === "email") {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            return response(
              res,
              400,
              `Invalid email format for ${field.inputName}`
            );
          }
        }
        customFields[field.inputName] = value;
      }
    }
  }

  // --- Extract basic info ---
  const fullName = req.body.fullName || pickFullName(customFields);
  const email = req.body.email || pickEmail(customFields);
  const phone = req.body.phone || pickPhone(customFields);
  const company = req.body.company || pickCompany(customFields);

  if (!formFields.length && (!fullName || !email || !phone)) {
    return response(res, 400, "Full name, email, and phone are required");
  }

  // --- Prevent duplicates ---
  const orClauses = [];
  if (email) orClauses.push({ email });
  if (phone) orClauses.push({ phone });

  if (orClauses.length) {
    const dup = await Registration.findOne({ eventId, $or: orClauses });
    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  // --- Create registration ---
  const newRegistration = await Registration.create({
    eventId,
    fullName,
    email,
    phone,
    company,
    customFields,
  });

  // --- Increment event counter ---
  event.registrations += 1;
  await event.save();

  // --- Generate and send email using util ---
  const displayName =
    fullName || (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

  const { subject, html, qrCodeDataUrl } = await buildRegistrationEmail({
    event,
    registration: newRegistration,
    displayName,
    customFields,
  });

  if (email) {
    await sendEmail(
      email,
      subject,
      html,
      qrCodeDataUrl,
      event.agendaUrl ? [{ filename: "Agenda.pdf", path: event.agendaUrl }] : []
    );
    newRegistration.emailSent = true;
    await newRegistration.save();
  }

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Registration successful", newRegistration);
});

// UPDATE registration (Admin/Staff editable)
exports.updateRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { fields } = req.body; 

  const reg = await Registration.findById(id);
  if (!reg) return response(res, 404, "Registration not found");

  // Merge into existing customFields map
  const newCustomFields = { ...Object.fromEntries(reg.customFields), ...fields };

  // Determine updated top-level fields
  const fullName =
    fields["Full Name"] ||
    fields["fullName"] ||
    fields["Name"] ||
    reg.fullName;
  const email = fields["Email"] || fields["email"] || reg.email;
  const phone = fields["Phone"] || fields["phone"] || reg.phone;
  const company =
    fields["Company"] ||
    fields["Institution"] ||
    fields["Organization"] ||
    fields["company"] ||
    reg.company;

  reg.customFields = newCustomFields;
  reg.fullName = fullName;
  reg.email = email;
  reg.phone = phone;
  reg.company = company;

  await reg.save();

  return response(res, 200, "Registration updated successfully", reg);
});

exports.unsentCount = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  const unsentCount = await Registration.countDocuments({
    eventId: event._id,
    isDeleted: { $ne: true },
    $or: [{ emailSent: false }, { emailSent: { $exists: false } }],
  });

  return response(res, 200, "Unsent count retrieved", { unsentCount });
});

exports.sendBulkEmails = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  // Fetch unsent registrations
  const pendingRegs = await Registration.find({
    eventId: event._id,
    isDeleted: { $ne: true },
    $or: [{ emailSent: false }, { emailSent: { $exists: false } }],
  });

  if (!pendingRegs.length)
    return response(res, 200, "All registration emails already sent.");

  const total = pendingRegs.length;
  let processed = 0;
  let sentCount = 0;

  for (const reg of pendingRegs) {
    processed++;

    try {
      const cf = reg.customFields ? Object.fromEntries(reg.customFields) : {};
      const fullName = reg.fullName || pickFullName(cf);
      const email = reg.email || pickEmail(cf);

      if (!email) {
        emitEmailProgress(event._id.toString(), processed, total);
        continue;
      }

      const displayName =
        fullName || (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

      const { subject, html, qrCodeDataUrl } = await buildRegistrationEmail({
        event,
        registration: reg,
        displayName,
        customFields: cf,
      });

      await sendEmail(email, subject, html, qrCodeDataUrl);

      reg.emailSent = true;
      await reg.save();

      sentCount++;
    } catch (err) {
      console.error("Email send error:", err.message);
    }

    emitEmailProgress(event._id.toString(), processed, total);
  }

  emitEmailProgress(event._id.toString(), total, total);

  return response(
    res,
    200,
    `Bulk emails sent to ${sentCount}/${total} registrations.`
  );
});

// GET paginated registrations by event using slug (includes walk-ins + customFields)
exports.getRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public") {
    return response(res, 400, "This event is not public");
  }

  const eventId = event._id;
  const totalRegistrations = await Registration.countDocuments({
    eventId,
    deletedAt: { $exists: false },
  });

  const registrations = await Registration.find({ eventId })
    .notDeleted()
    .skip((page - 1) * limit)
    .limit(limit);

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email staffType")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        token: reg.token,
        emailSent: reg.emailSent,
        createdAt: reg.createdAt,

        // classic top‐level values (may be null if you used custom fields)
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        company: reg.company,

        // your entire customFields object
        customFields: reg.customFields || {},

        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

  return response(res, 200, "Registrations fetched", {
    data: enhanced,
    pagination: {
      totalRegistrations,
      totalPages: Math.max(1, Math.ceil(totalRegistrations / limit)),
      currentPage: page,
      perPage: limit,
    },
  });
});

// GET all registrations by event using slug (for export)
exports.getAllPublicRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public") {
    return response(res, 400, "This event is not public");
  }

  const eventId = event._id;

  const registrations = await Registration.find({ eventId }).notDeleted();
  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email staffType")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        token: reg.token,
        emailSent: reg.emailSent,
        createdAt: reg.createdAt,

        // classic fields
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        company: reg.company,

        // customFields and walk-ins
        customFields: reg.customFields || {},
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

  return response(res, 200, "All public registrations fetched", enhanced);
});

// VERIFY registration by QR token and create a WalkIn
exports.verifyRegistrationByToken = asyncHandler(async (req, res) => {
  const { token } = req.query;
  const staffUser = req.user;

  if (!token) return response(res, 400, "Token is required");
  if (!staffUser?.id)
    return response(res, 401, "Unauthorized – no scanner info");

  const registration = await Registration.findOne({ token }).populate(
    "eventId"
  );
  if (!registration) return response(res, 404, "Registration not found");

  const walkin = new WalkIn({
    registrationId: registration._id,
    eventId: registration.eventId?._id,
    scannedBy: staffUser.id,
  });
  await walkin.save();

  const cf = registration.customFields
    ? Object.fromEntries(registration.customFields)
    : {};

  const normalized = {
    token: registration.token,
    fullName: pickFullName(cf) || registration.fullName || null,
    email: pickEmail(cf) || registration.email || null,
    phone: pickPhone(cf) || registration.phone || null,
    company: pickCompany(cf) || registration.company || null,
    title: pickTitle(cf) || null,
    badgeIdentifier: pickBadgeIdentifier(cf) || null,
  };

  const zpl = buildBadgeZpl({
    fullName: normalized.fullName || "N/A",
    company: normalized.company || "",
    eventName: registration.eventId?.name,
    token: registration.token,
  });

  recomputeAndEmit(registration.eventId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Registration verified and walk-in recorded", {
    ...normalized,
    eventName: registration.eventId?.name || "Unknown Event",
    eventId: registration.eventId?._id,
    showQrOnBadge: registration.eventId?.showQrOnBadge,
    createdAt: registration.createdAt,
    walkinId: walkin._id,
    scannedAt: walkin.scannedAt,
    scannedBy: { name: staffUser.name || staffUser.email },
    zpl,
  });
});

// Soft delete registration
exports.deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  const registration = await Registration.findById(id).populate("eventId");
  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  const businessId = registration.eventId?.businessId;

  await registration.softDelete(req.user.id);

  // decrement count
  await Event.findByIdAndUpdate(registration.eventId, {
    $inc: { registrations: -1 },
  });

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Registration moved to recycle bin");
});

// Restore single registration
exports.restoreRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  await reg.restore();
  const event = await Event.findByIdAndUpdate(
    reg.eventId,
    { $inc: { registrations: 1 } },
    { new: true, lean: true }
  );

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Registration restored successfully", reg);
});

// Restore ALL registrations
exports.restoreAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length) {
    return response(res, 404, "No registrations found in trash to restore");
  }

  for (const reg of regs) {
    await reg.restore();
    await Event.findByIdAndUpdate(reg.eventId, { $inc: { registrations: 1 } });
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${regs.length} registrations`);
});

// Permanent delete single registration
exports.permanentDeleteRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({
    _id: req.params.id,
  }).populate("eventId", "businessId"); // only fetch businessId

  if (!reg) return response(res, 404, "Registration not found in trash");

  const businessId = reg.eventId?.businessId || null;

  await reg.deleteOne();

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Registration permanently deleted");
});

// PERMANENT DELETE ALL public registrations (cascade walk-ins)
exports.permanentDeleteAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length) {
    return response(res, 404, "No registrations found in trash to delete");
  }

  const regIds = regs.map((r) => r._id);

  await WalkIn.deleteMany({ registrationId: { $in: regIds } });
  const result = await Registration.deleteManyDeleted();

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Permanently deleted ${result.deletedCount} registrations and their walk-ins`
  );
});
