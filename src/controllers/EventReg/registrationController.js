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
const sendWhatsappMessage = require("../../services/whatsappService");
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
} = require("../../socket/modules/eventreg/eventRegSocket");
const e = require("express");

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

  // 1) Process dynamic customFields (unchanged)…
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
        customFields[field.inputName] = value;
      }
    }
  }

  // 2) Extract core props from either classic or custom:
  let fullName = req.body.fullName || pickFullName(customFields);
  let email = req.body.email || pickEmail(customFields);
  let phone = req.body.phone || pickPhone(customFields);
  let company = req.body.company || pickCompany(customFields);

  // 3) If no formFields, enforce classic fields:
  if (!formFields.length) {
    if (!fullName || !email || !phone) {
      return response(res, 400, "Full name, email, and phone are required");
    }
  }

  // 4) Prevent duplicates (only include clauses for fields you actually have)
  const orClauses = [];
  if (email) orClauses.push({ email });
  if (phone) orClauses.push({ phone });

  if (orClauses.length) {
    const dup = await Registration.findOne({
      eventId,
      $or: orClauses,
    });
    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  // 5) Create registration…
  const newRegistration = await Registration.create({
    eventId,
    fullName,
    email,
    phone,
    company,
    customFields,
  });

  // 6) Increment counter
  event.registrations += 1;
  await event.save();

  // 7) Generate QR
  const qrCodeDataUrl = await QRCode.toDataURL(newRegistration.token);
  const qrBuffer = await QRCode.toBuffer(newRegistration.token);
  //const qrUpload = await uploadToCloudinary(qrBuffer, "image/png");

  // 8) Build displayName fallback
  const displayName = fullName || "Guest";

  // 9) Build customFields summary HTML
  let customFieldHtml = "";
  if (formFields.length && Object.keys(customFields).length) {
    const items = formFields
      .map((f) => {
        const v = customFields[f.inputName];
        return v ? `<li><strong>${f.inputName}:</strong> ${v}</li>` : "";
      })
      .filter(Boolean)
      .join("");
    if (items) {
      customFieldHtml = `
        <p style="font-size:16px;">Here are your submitted details:</p>
        <ul style="font-size:15px; line-height:1.6; padding-left:20px;">
          ${items}
        </ul>
      `;
    }
  }

  // 10) Email HTML (uses displayName & custom summary)
  const emailHtml = `
<div style="font-family:Arial,sans-serif;padding:20px;background:#f4f4f4;color:#333">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#007BFF;padding:20px;text-align:center">
      <h2 style="color:#fff;margin:0">Welcome to ${event.name}</h2>
    </div>
    <div style="padding:30px">
      <p>Hi <strong>${displayName}</strong>,</p>
      <p>You’re confirmed for <strong>${event.name}</strong>!</p>
      ${
        event.logoUrl
          ? `<div style="text-align:center;margin:20px 0">
               <img src="${event.logoUrl}" style="max-width:180px;max-height:100px"/>
             </div>`
          : ""
      }
      <p>Event Details:</p>
      <ul style="padding-left:20px">
        <li><strong>Date:</strong> ${event.startDate.toDateString()}${
    event.endDate && event.endDate.getTime() !== event.startDate.getTime()
      ? ` to ${event.endDate.toDateString()}`
      : ""
  }</li>
        <li><strong>Venue:</strong> ${event.venue}</li>
        ${
          event.description
            ? `<li><strong>About:</strong> ${event.description}</li>`
            : ""
        }
      </ul>
      ${customFieldHtml}
      <p>Please present this QR at check-in:</p>
      <div style="text-align:center;margin:25px 0">{{qrImage}}</div>
      <p>Your Token: <strong>${newRegistration.token}</strong></p>
      <hr/>
      <p>Questions? Reply to this email.</p>
      <p>See you soon!</p>
    </div>
  </div>
</div>
`;

  // 11) Send Email & WhatsApp if we have address/number
  if (email) {
    await sendEmail(
      email,
      `Registration Confirmed: ${event.name}`,
      emailHtml,
      qrCodeDataUrl,
      event.agendaUrl ? [{ filename: "Agenda.pdf", path: event.agendaUrl }] : []
    );
  }
  if (phone) {
    const whatsappText = `Hi ${displayName}, you’re registered for "${event.name}". Show this QR at check-in:`;
    // await sendWhatsappMessage(phone, whatsappText, qrUpload.secure_url);
  }

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Registration successful", newRegistration);
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
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        token: reg.token,
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
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        token: reg.token,
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
