const mongoose = require("mongoose");
const XLSX = require("xlsx");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const QRCode = require("qrcode");
const { formatLocalDateTime } = require("../../utils/dateUtils");
const Business = require("../../models/Business");
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
  pickWing,
} = require("../../utils/customFieldUtils");
const { buildBadgeZpl } = require("../../utils/zebraZpl");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const {
  emitUploadProgress,
  emitEmailProgress,
  emitLoadingProgress
} = require("../../socket/modules/eventreg/eventRegSocket");

const { buildRegistrationEmail } = require("../../utils/emailTemplateBuilder");

// PROCESSORS
const uploadProcessor = require("../../processors/eventreg/uploadProcessor");
const emailProcessor = require("../../processors/eventreg/emailProcessor");

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

// -------------------------------------------
// BULK UPLOAD (Early Response + Background Job)
// -------------------------------------------
exports.uploadRegistrations = asyncHandler(async (req, res) => {
  const { slug } = req.params;
if (!slug) return response(res, 400, "Event Slug is required");

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  if (!req.file) return response(res, 400, "Excel file is required");

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

  if (!rows.length) {
    return response(res, 400, "Uploaded file is empty");
  }

  // Early response immediately
  response(res, 200, "Upload started", {
    total: rows.length,
  });

  // Background processor
  setImmediate(() => {
    uploadProcessor(event, rows)
      .catch(err => console.error("UPLOAD PROCESSOR FAILED:", err));
  });
});

// EXPORT filtered registrations to CSV
exports.exportRegistrations = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const {
    search,
    token,
    scannedBy,
    createdFrom,
    createdTo,
    scannedFrom,
    scannedTo,
    ...dynamicFiltersRaw
  } = req.query;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  const eventId = event._id;

  // -------------------------
  // PREPARE DB QUERY FILTERS
  // -------------------------
  const mongoQuery = {
    eventId,
    isDeleted: { $ne: true }
  };

  if (token) mongoQuery.token = new RegExp(token, "i");

  // Dynamic field filters
  const dynamicFilters = Object.entries(dynamicFiltersRaw)
    .filter(([key]) => key.startsWith("field_"))
    .reduce((acc, [key, val]) => {
      const fieldName = key.replace("field_", "");
      acc[`customFields.${fieldName}`] = new RegExp(val, "i");
      return acc;
    }, {});
  Object.assign(mongoQuery, dynamicFilters);

  // CreatedAt date range
  if (createdFrom || createdTo) {
    mongoQuery.createdAt = {};
    if (createdFrom) mongoQuery.createdAt.$gte = new Date(Number(createdFrom));
    if (createdTo) mongoQuery.createdAt.$lte = new Date(Number(createdTo));
  }

  // -------------------------
  // FETCH DB REGISTRATIONS
  // -------------------------
  let regs = await Registration.find(mongoQuery).lean();

  // -------------------------
  // SEARCH FILTER
  // -------------------------
  if (search) {
    const s = search.toLowerCase();
    regs = regs.filter(r => {
      const cf = Object.values(r.customFields || {}).join(" ").toLowerCase();

      return (
        (r.fullName || "").toLowerCase().includes(s) ||
        (r.email || "").toLowerCase().includes(s) ||
        (r.phone || "").toLowerCase().includes(s) ||
        (r.company || "").toLowerCase().includes(s) ||
        (r.token || "").toLowerCase().includes(s) ||
        cf.includes(s)
      );
    });
  }

  // -------------------------
  // WALK-IN FILTERS
  // -------------------------
  const walkins = await WalkIn.find({ eventId })
    .populate("scannedBy", "name email staffType")
    .lean();

  const walkMap = {};
  walkins.forEach(w => {
    const id = w.registrationId.toString();
    if (!walkMap[id]) walkMap[id] = [];
    walkMap[id].push(w);
  });

  let filteredRegs = regs;
  if (scannedBy || scannedFrom || scannedTo) {
    filteredRegs = regs.filter(r => {
      const list = walkMap[r._id.toString()] || [];

      return list.some(w => {
        if (scannedBy) {
          const match =
            (w.scannedBy?.name || "").toLowerCase().includes(scannedBy.toLowerCase()) ||
            (w.scannedBy?.email || "").toLowerCase().includes(scannedBy.toLowerCase());

          if (!match) return false;
        }

        if (scannedFrom && new Date(w.scannedAt) < new Date(Number(scannedFrom))) {
          return false;
        }

        if (scannedTo && new Date(w.scannedAt) > new Date(Number(scannedTo))) {
          return false;
        }

        return true;
      });
    });
  }

  regs = filteredRegs;

  // -------------------------
  // DYNAMIC FIELDS
  // -------------------------
  const dynamicFields = event.formFields?.length
    ? event.formFields.map(f => f.inputName)
    : ["fullName", "email", "phone", "company"];

  // -------------------------
  // CSV START
  // -------------------------
  const lines = [];

  const business = await Business.findById(event.businessId).lean();

  const exportedAt = formatLocalDateTime(Date.now());

  // HEADER SECTION (RESTORED)
  lines.push(`Event Name,${event.name || "N/A"}`);
  lines.push(`Business Name,${business?.name || "N/A"}`);
  lines.push(`Logo URL,${event.logoUrl || "N/A"}`);
  lines.push(`Event Slug,${event.slug || "N/A"}`);
  lines.push(`Total Registrations,${event.registrations || 0}`);
  lines.push(`Exported Registrations,${regs.length}`);
  lines.push(`Exported At,"${exportedAt}"`);
  lines.push(""); // spacer

  // -------------------------
  // REGISTRATIONS SECTION
  // -------------------------
  lines.push("=== Registrations ===");

  const regHeaders = [...dynamicFields, "Token", "Registered At"];
  lines.push(regHeaders.join(","));

  regs.forEach(reg => {
    const row = dynamicFields.map(f =>
      `"${((reg.customFields?.[f] ?? reg[f] ?? "") + "").replace(/"/g, '""')}"`
    );

    row.push(`"${reg.token}"`);
    row.push(`"${formatLocalDateTime(reg.createdAt)}"`);

    lines.push(row.join(","));
  });

  // -------------------------
  // WALK-INS SECTION
  // -------------------------
  const allWalkins = walkins.filter(w =>
    regs.some(r => r._id.toString() === w.registrationId.toString())
  );

  if (allWalkins.length > 0) {
    lines.push("");
    lines.push("=== Walk-ins ===");

    const wiHeaders = [
      ...dynamicFields,
      "Token",
      "Registered At",
      "Scanned At",
      "Scanned By",
      "Staff Type"
    ];
    lines.push(wiHeaders.join(","));

    allWalkins.forEach(w => {
      const reg = regs.find(r => r._id.toString() === w.registrationId.toString());

      const row = dynamicFields.map(f =>
        `"${((reg?.customFields?.[f] ?? reg?.[f] ?? "") + "").replace(/"/g, '""')}"`
      );

      row.push(`"${reg.token}"`);
      row.push(`"${formatLocalDateTime(reg.createdAt)}"`);
      row.push(`"${formatLocalDateTime(w.scannedAt)}"`);
      row.push(`"${w.scannedBy?.name || w.scannedBy?.email || ""}"`);
      row.push(`"${w.scannedBy?.staffType || ""}"`);

      lines.push(row.join(","));
    });
  }

  // -------------------------
  // SEND CSV
  // -------------------------
  const csv = "\uFEFF" + lines.join("\n");

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${event.slug}_filtered_registrations.csv`
  );
  res.setHeader("Content-Type", "text/csv;charset=utf-8");

  return res.send(csv);
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
    const result = await sendEmail(
      email,
      subject,
      html,
      qrCodeDataUrl,
      event.agendaUrl ? [{ filename: "Agenda.pdf", path: event.agendaUrl }] : []
    );
    if (result.success) {
      newRegistration.emailSent = true;
      await newRegistration.save();
    } else {
      console.error(
        `Email failed for ${email}:`,
        result.response || result.error
      );
    }
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
  const newCustomFields = {
    ...Object.fromEntries(reg.customFields),
    ...fields,
  };

  // Determine updated top-level fields
  const fullName =
    fields["Full Name"] || fields["fullName"] || fields["Name"] || reg.fullName;
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

// -------------------------------------------
// BULK EMAIL SEND (Early Response + Background Job)
// -------------------------------------------
exports.sendBulkEmails = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).lean();
  if (!event) return response(res, 404, "Event not found");

  const pending = await Registration.find({
    eventId: event._id,
    isDeleted: { $ne: true },
    $or: [{ emailSent: false }, { emailSent: { $exists: false } }],
  })
    .select("fullName email company customFields token")
    .lean();

  if (!pending.length) {
    // Send completion signal
    emitEmailProgress(event._id.toString(), {
      sent: 0,
      failed: 0,
      processed: 0,
      total: 0,
    });

    return response(res, 200, "All emails already sent.");
  }

  // Early response immediately
  response(res, 200, "Bulk email job started", {
    total: pending.length,
  });

  // Background processor
  setImmediate(() => {
    emailProcessor(event, pending)
      .catch(err => console.error("EMAIL PROCESSOR FAILED:", err));
  });
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

async function loadRemainingRecords(eventId, total) {
  try {
    const BATCH_SIZE = 50;
    const startFrom = 50;

    for (let skip = startFrom; skip < total; skip += BATCH_SIZE) {
      const limit = Math.min(BATCH_SIZE, total - skip);

      const registrations = await Registration.find({ eventId })
        .where('isDeleted').ne(true)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean();

      if (!registrations.length) break;

      const enhanced = await Promise.all(
        registrations.map(async (reg) => {
          const walkIns = await WalkIn.find({ registrationId: reg._id })
            .populate("scannedBy", "name email staffType")
            .sort({ scannedAt: -1 })
            .lean();

          return {
            _id: reg._id,
            token: reg.token,
            emailSent: reg.emailSent,
            createdAt: reg.createdAt,
            fullName: reg.fullName,
            email: reg.email,
            phone: reg.phone,
            company: reg.company,
            customFields: reg.customFields || {},
            walkIns: walkIns.map((w) => ({
              scannedAt: w.scannedAt,
              scannedBy: w.scannedBy,
            })),
          };
        })
      );

      const currentLoaded = skip + enhanced.length;
      emitLoadingProgress(eventId.toString(), currentLoaded, total, enhanced);

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    emitLoadingProgress(eventId.toString(), total, total);
  } catch (err) {
    console.error("Background loading failed:", err.message);
  }
}

// GET all registrations by event using slug - initial load only
exports.getAllPublicRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public") {
    return response(res, 400, "This event is not public");
  }

  const eventId = event._id;
  const totalCount = await Registration.countDocuments({
    eventId,
    isDeleted: { $ne: true }
  });

  // Return first 50 records immediately
  const registrations = await Registration.find({ eventId })
    .where('isDeleted').ne(true)
    .sort({ createdAt: 1 })
    .limit(50)
    .lean();

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email staffType")
        .sort({ scannedAt: -1 })
        .lean();

      return {
        _id: reg._id,
        token: reg.token,
        emailSent: reg.emailSent,
        createdAt: reg.createdAt,
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        company: reg.company,
        customFields: reg.customFields || {},
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

  // Start background loading if more records exist
  if (totalCount > 50) {
    setImmediate(() => {
      loadRemainingRecords(eventId, totalCount);
    });
  }

  return response(res, 200, "Initial registrations loaded", {
    data: enhanced,
    total: totalCount,
    loaded: enhanced.length,
  });
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
    wing: pickWing(cf) || null,
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
