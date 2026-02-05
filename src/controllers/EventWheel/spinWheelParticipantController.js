const XLSX = require("xlsx");
const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const SpinWheelWinner = require("../../models/SpinWheelWinner");
const WalkIn = require("../../models/WalkIn");
const SpinWheel = require("../../models/SpinWheel");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const User = require("../../models/User");
const Event = require("../../models/Event");
const Registration = require("../../models/Registration");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { runSpinWheelSync } = require("../../processors/eventwheel/spinWheelSyncProcessor");
const uploadProcessor = require("../../processors/eventwheel/uploadProcessor");
const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
  DEFAULT_ISO_CODE,
  COUNTRY_CODES,
} = require("../../utils/countryCodes");
const { validatePhoneNumberByCountry } = require("../../utils/phoneValidation");

// Add Participant (Only Admin for "admin" SpinWheels)
exports.addParticipant = asyncHandler(async (req, res) => {
  const { name, phone, company, spinWheelId, isoCode } = req.body;

  if (!name || !spinWheelId)
    return response(res, 400, "Name and SpinWheel ID are required");

  const wheel = await SpinWheel.findById(spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type === "synced") {
    return response(
      res,
      403,
      "Participants for synced wheels are managed automatically"
    );
  }

  if (
    wheel.type === "admin" &&
    (!req.user || (req.user.role !== "admin" && req.user.role !== "superadmin" && req.user.role !== "business"))
  ) {
    return response(
      res,
      403,
      "Only admins or business users can add participants for this SpinWheel."
    );
  }

  // Phone normalization and isoCode handling
  let phoneLocalNumber = phone;
  let phoneIsoCode = isoCode || DEFAULT_ISO_CODE;
  let phoneForValidation = null;

  if (phone) {
    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.startsWith("+")) {
      const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
      if (extracted.isoCode) {
        phoneLocalNumber = extracted.localNumber;
        phoneIsoCode = extracted.isoCode;
        phoneForValidation = normalizedPhone;
      } else {
        phoneLocalNumber = normalizedPhone;
        phoneIsoCode = phoneIsoCode || DEFAULT_ISO_CODE;
        phoneForValidation = combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
      }
    } else {
      phoneLocalNumber = normalizedPhone;
      phoneIsoCode = phoneIsoCode || DEFAULT_ISO_CODE;
      phoneForValidation = combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
    }

    // Validate phone number with digit count check
    const phoneCheck = validatePhoneNumberByCountry(phoneForValidation, phoneIsoCode);
    if (!phoneCheck.valid) {
      return response(res, 400, phoneCheck.error);
    }
  }

  const newParticipant = await SpinWheelParticipant.createWithAuditUser(
    {
      name,
      phone: phoneLocalNumber,
      isoCode: phoneIsoCode,
      company,
      spinWheel: spinWheelId,
    },
    req.user
  );

  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Participant added successfully", newParticipant);
});

// Add Participants in Bulk (for onspot type)
exports.addParticipantsOnSpot = asyncHandler(async (req, res) => {
  const { slug, participants } = req.body;

  if (
    !participants ||
    !Array.isArray(participants) ||
    participants.length === 0
  ) {
    return response(res, 400, "Participants array is required.");
  }

  const wheel = await SpinWheel.findOne({ slug });
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type !== "onspot") {
    return response(res, 403, "On-spot entry not allowed for this wheel");
  }
  // Clear existing participants (PERMANENT)
  await SpinWheelParticipant.deleteMany({ spinWheel: wheel._id });

  const newParticipants = participants.map((name) => ({
    name,
    spinWheel: wheel._id,
  }));

  await SpinWheelParticipant.createWithAuditUser(newParticipants, req.user);

  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Participants updated successfully");
});

// Sync Participants from Event Registrations (for synced type)
exports.syncSpinWheelParticipants = asyncHandler(async (req, res) => {
  const { filters = {} } = req.body;

  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return response(res, 400, "Filters must be an object.");
  }

  const wheel = await SpinWheel.findById(req.params.spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type !== "synced") {
    return response(res, 400, "SpinWheel is not of synced type");
  }

  if (!wheel.eventSource?.eventId) {
    return response(res, 400, "eventSource configuration missing");
  }

  await SpinWheel.updateOne(
    { _id: wheel._id },
    { $set: { "eventSource.filters": filters } }
  );

  response(res, 200, "SpinWheel sync started");

  setImmediate(() => {
    runSpinWheelSync(wheel._id, filters).catch(console.error);
  });
});

// Get SpinWheel Sync Filters
exports.getSpinWheelSyncFilters = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type !== "synced") {
    return response(res, 400, "SpinWheel is not of synced type");
  }

  const eventId = wheel.eventSource?.eventId;
  if (!eventId) {
    return response(res, 400, "Event not configured for sync");
  }

  // Fetch DISTINCT scannedBy users for this event
  const scannedByUserIds = await WalkIn.distinct("scannedBy", {
    eventId,
    isDeleted: { $ne: true },
  });

  // Populate minimal user info
  const users = await User.find(
    { _id: { $in: scannedByUserIds } },
    { _id: 1, name: 1, email: 1 }
  ).lean();

  return response(res, 200, "Sync filter values retrieved", {
    scannedBy: users,
  });
});

// Helper function to build participants query
function buildParticipantsQuery(wheelId, options = {}) {
  const {
    visibleOnly = false,
    page = null,
    limit = null,
    selectFields = "_id name phone isoCode company",
    sortByName = true,
  } = options;

  const query = { spinWheel: wheelId };
  if (visibleOnly) {
    query.visible = true;
  }

  let baseQuery = SpinWheelParticipant.find(query)
    .notDeleted()
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (sortByName) {
    baseQuery = baseQuery.sort({ name: 1 });
  }

  if (page !== null && limit !== null) {
    baseQuery = baseQuery.skip((page - 1) * limit).limit(limit);
  }

  const finalSelectFields = visibleOnly
    ? selectFields
    : `${selectFields}${selectFields.includes("visible") ? "" : " visible"}`;

  return baseQuery.select(finalSelectFields);
}

// Helper function to enrich participants with winner status
async function enrichWithWinnerStatus(participants) {
  if (!participants || participants.length === 0) return participants;

  const participantIds = participants.map((p) => p._id || p);
  const winners = await SpinWheelWinner.find({
    participant: { $in: participantIds },
  }).select("participant");

  const winnerMap = {};
  winners.forEach((w) => {
    winnerMap[w.participant.toString()] = true;
  });

  return participants.map((p) => ({
    ...(p.toObject ? p.toObject() : p),
    isWinner: !!winnerMap[(p._id || p).toString()],
  }));
}

// Get Participants by Slug (for public spin wheel - only visible participants)
exports.getParticipantsBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const wheel = await SpinWheel.findOne({ slug })
    .select("_id type")
    .notDeleted();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const participants = await buildParticipantsQuery(wheel._id, {
    visibleOnly: true,
    selectFields: "_id name phone isoCode company",
    sortByName: wheel.type !== "onspot",
  });

  return response(
    res,
    200,
    "Participants retrieved successfully",
    participants
  );
});

// Get Participants for CMS (all participants with pagination and winner status)
exports.getParticipantsForCMS = asyncHandler(async (req, res) => {
  const { spinWheelId } = req.params;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const wheel = await SpinWheel.findById(spinWheelId).notDeleted();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const countQuery = { spinWheel: wheel._id, isDeleted: { $ne: true } };
  const totalParticipants = await SpinWheelParticipant.countDocuments(countQuery);

  const participants = await buildParticipantsQuery(wheel._id, {
    visibleOnly: false,
    page,
    limit,
    selectFields: "_id name phone isoCode company visible createdAt updatedAt createdBy updatedBy",
  });

  const participantsWithWinnerStatus = await enrichWithWinnerStatus(participants);

  return response(res, 200, "Participants retrieved successfully", {
    data: participantsWithWinnerStatus,
    pagination: {
      totalParticipants,
      totalPages: Math.max(1, Math.ceil(totalParticipants / limit)),
      currentPage: page,
      perPage: limit,
    },
  });
});

// Get Single Participant by ID
exports.getParticipantById = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findById(req.params.id)
    .notDeleted()
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!participant) return response(res, 404, "Participant not found");

  return response(res, 200, "Participant retrieved successfully", participant);
});

// Update Participant
exports.updateParticipant = asyncHandler(async (req, res) => {
  const { name, phone, company, isoCode } = req.body;
  const participant = await SpinWheelParticipant.findById(
    req.params.id
  ).populate("spinWheel", "business");

  if (!participant) return response(res, 404, "Participant not found");

  if (participant.spinWheel.type === "synced") {
    return response(res, 403, "Cannot update participants of a synced wheel");
  }

  participant.name = name !== undefined ? name : participant.name;
  participant.company = company !== undefined ? company : participant.company;

  // Phone normalization and isoCode handling
  if (phone !== undefined) {
    let phoneLocalNumber = phone;
    let phoneIsoCode = isoCode !== undefined ? isoCode : participant.isoCode || DEFAULT_ISO_CODE;
    let phoneForValidation = null;

    if (phone) {
      const normalizedPhone = normalizePhone(phone);

      if (normalizedPhone.startsWith("+")) {
        const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
        if (extracted.isoCode) {
          phoneLocalNumber = extracted.localNumber;
          phoneIsoCode = extracted.isoCode;
          phoneForValidation = normalizedPhone;
        } else {
          phoneLocalNumber = normalizedPhone;
          phoneIsoCode = phoneIsoCode || DEFAULT_ISO_CODE;
          phoneForValidation = combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
        }
      } else {
        phoneLocalNumber = normalizedPhone;
        phoneIsoCode = phoneIsoCode || DEFAULT_ISO_CODE;
        phoneForValidation = combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
      }

      // Validate phone number with digit count check
      const phoneCheck = validatePhoneNumberByCountry(phoneForValidation, phoneIsoCode);
      if (!phoneCheck.valid) {
        return response(res, 400, phoneCheck.error);
      }
    }

    participant.phone = phoneLocalNumber;
    participant.isoCode = phoneIsoCode;
  } else if (isoCode !== undefined) {
    participant.isoCode = isoCode;
  }

  participant.setAuditUser(req.user);
  await participant.save();

  // Fire background recompute
  recomputeAndEmit(participant.spinWheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Participant updated successfully", participant);
});

// Soft delete participant
exports.deleteParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findById(
    req.params.id
  ).populate("spinWheel", "business type");

  if (!participant) {
    return response(res, 404, "Participant not found");
  }

  // Synced wheels → PERMANENT delete
  if (participant.spinWheel.type === "synced") {
    await participant.deleteOne();
  } else {
    // Admin / onspot → soft delete
    await participant.softDelete(req.user.id);
  }

  // Fire background recompute (correct path)
  recomputeAndEmit(participant.spinWheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    participant.spinWheel.type === "synced"
      ? "Participant deleted"
      : "Participant moved to recycle bin"
  );
});

// Restore participant
exports.restoreParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findOneDeleted({
    _id: req.params.id,
  }).populate("spinWheel", "business");
  if (!participant) return response(res, 404, "Participant not found in trash");

  await participant.restore();

  // Fire background recompute
  recomputeAndEmit(participant.spinwheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Participant restored", participant);
});

// Permanently delete participant
exports.permanentDeleteParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findOneDeleted({
    _id: req.params.id,
  }).populate("spinWheel", "business");
  if (!participant) return response(res, 404, "Participant not found in trash");

  await participant.deleteOne();
  // Fire background recompute
  recomputeAndEmit(participant.spinwheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Participant permanently deleted");
});

// Restore all participants
exports.restoreAllParticipants = asyncHandler(async (req, res) => {
  const deletedParticipants = await SpinWheelParticipant.findDeleted();

  for (const participant of deletedParticipants) {
    await participant.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedParticipants.length} participants restored.`
  );
});

// Permanently delete all participants
exports.permanentDeleteAllParticipants = asyncHandler(async (req, res) => {
  const deletedParticipants = await SpinWheelParticipant.findDeleted();

  for (const participant of deletedParticipants) {
    await participant.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedParticipants.length} participants permanently deleted.`
  );
});

exports.exportSpinWheelParticipantsXlsx = asyncHandler(async (req, res) => {
  const { spinWheelId } = req.params;

  const wheel = await SpinWheel.findById(spinWheelId).lean();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const participants = await SpinWheelParticipant.find({
    spinWheel: wheel._id,
  })
    .notDeleted()
    .lean();

  /* ===============================
     BASE WORKSHEET DATA
  =============================== */

  const rows = [];

  // Header
  rows.push([`Wheel: ${wheel.title}`]);

  if (wheel.type === "synced" && wheel.eventSource?.eventId) {
    const event = await Event.findById(wheel.eventSource.eventId).lean();
    rows.push([`Event: ${event?.name || "N/A"}`]);
    rows.push(["Type: Synced"]);

    const scannedByIds = wheel.eventSource.filters?.scannedBy || [];

    if (scannedByIds.length) {
      const scanners = await User.find(
        { _id: { $in: scannedByIds } },
        { name: 1 }
      ).lean();

      rows.push([
        `Filters → Scanned By: ${scanners.map((u) => u.name).join(", ")}`,
      ]);
    }
  } else {
    rows.push([`Type: ${wheel.type}`]);
  }

  rows.push([]); // spacer

  /* ===============================
     PARTICIPANT TABLE
  =============================== */

  let tableHeaders = ["Name", "isoCode", "Phone", "Company"];
  let tableRows = [];

  // ===============================
  // SYNCED WHEEL EXPORT
  // ===============================
  if (wheel.type === "synced" && wheel.eventSource?.eventId) {
    const eventId = wheel.eventSource.eventId;
    const scannedByIds = wheel.eventSource.filters?.scannedBy || [];

    // If no scanners selected → fallback
    if (!scannedByIds.length) {
      tableRows = participants.map((p) => [
        p.name,
        p.isoCode || "",
        p.phone || "",
        p.company || "",
      ]);
    } else {
      // 1. Load scanners
      const scanners = await User.find(
        { _id: { $in: scannedByIds } },
        { _id: 1, name: 1 }
      ).lean();

      // 2. Load walk-ins (source of truth)
      const walkIns = await WalkIn.find({
        eventId,
        scannedBy: { $in: scannedByIds },
        isDeleted: { $ne: true },
      })
        .select("registrationId scannedBy")
        .lean();

      // 3. Build registrationId → Set(scannerIds)
      const registrationScanMap = {};
      walkIns.forEach((w) => {
        const regId = w.registrationId.toString();
        if (!registrationScanMap[regId]) {
          registrationScanMap[regId] = new Set();
        }
        registrationScanMap[regId].add(w.scannedBy.toString());
      });

      // 4. Load registrations IN SAME ORDER AS SYNC
      const registrationIds = Object.keys(registrationScanMap);

      const registrations = await Registration.find({
        _id: { $in: registrationIds },
        eventId,
        isDeleted: { $ne: true },
      })
        .select("_id fullName phone company")
        .lean();

      // 5. Headers
      scanners.forEach((u) =>
        tableHeaders.push(`Scanned by ${u.name}`)
      );

      // 6. Rows (index-based match → stable)
      tableRows = participants.map((p, index) => {
        const reg = registrations[index];
        const scannedSet = reg
          ? registrationScanMap[reg._id.toString()]
          : null;

        const row = [
          p.name,
          p.isoCode || "",
          reg?.phone || "",
          reg?.company || "",
        ];

        scanners.forEach((u) => {
          row.push(
            scannedSet?.has(u._id.toString()) ? "✔" : ""
          );
        });

        return row;
      });
    }
  } else {
    // ===============================
    // NON-SYNCED WHEEL EXPORT
    // ===============================
    tableRows = participants.map((p) => [
      p.name,
      p.isoCode || "",
      p.phone || "",
      p.company || "",
    ]);
  }

  rows.push(tableHeaders);
  rows.push(...tableRows);

  /* ===============================
     CREATE XLSX
  =============================== */

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // Bold table header row
  const headerRowIndex = rows.findIndex(
    (r) => r.length && r[0] === tableHeaders[0]
  );

  if (headerRowIndex !== -1) {
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell =
        worksheet[XLSX.utils.encode_cell({ r: headerRowIndex, c })];
      if (cell) cell.s = { font: { bold: true } };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Participants");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=spinwheel_${wheel.slug}_participants.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  return res.send(buffer);
});

// Download sample Excel template (for admin type SpinWheels)
exports.downloadSampleExcel = asyncHandler(async (req, res) => {
  const { spinWheelId } = req.params;

  if (!spinWheelId) {
    return response(res, 400, "SpinWheel ID is required");
  }

  const wheel = await SpinWheel.findById(spinWheelId).notDeleted();
  if (!wheel) {
    return response(res, 404, "SpinWheel not found");
  }

  if (wheel.type !== "admin") {
    return response(
      res,
      403,
      "Sample Excel download is only available for admin type SpinWheels"
    );
  }

  const headers = ["Name", "isoCode", "Phone", "Company"];

  // Dummy rows with sample data
  const dummyRows = [
    ["John Doe", "us", "1234567890", "Acme Corp"],
    ["Jane Smith", "uk", "9876543210", "Tech Solutions"],
    ["Ahmed Ali", "ae", "5551234567", "Global Industries"],
  ];

  const rows = [headers, ...dummyRows];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  const headerRange = XLSX.utils.decode_range(ws["!ref"]);
  for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[cellAddress]) continue;
    if (!ws[cellAddress].s) ws[cellAddress].s = {};
    if (!ws[cellAddress].s.font) ws[cellAddress].s.font = {};
    ws[cellAddress].s.font.bold = true;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Participants");
  const sampleBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=spinwheel_${wheel.slug}_participants_template.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(sampleBuffer);
});

// Download country reference Excel file
exports.downloadCountryReference = asyncHandler(async (req, res) => {
  const formatDigits = (digits) => {
    if (typeof digits === "number") {
      return digits.toString();
    }
    if (typeof digits === "object" && digits.min && digits.max) {
      return `${digits.min}-${digits.max}`;
    }
    return "";
  };

  const countryHeaders = [["Country Name", "ISO Code", "Country Code", "No. of Digits"]];
  const countryRows = COUNTRY_CODES.map((cc) => [
    cc.country,
    cc.isoCode,
    cc.code,
    formatDigits(cc.digits),
  ]);
  const countryData = [...countryHeaders, ...countryRows];
  const countryWs = XLSX.utils.aoa_to_sheet(countryData);
  const countryWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(countryWb, countryWs, "Countries");
  const countryBuffer = XLSX.write(countryWb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=country_reference.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(countryBuffer);
});

// Upload Participants from Excel file (for admin type SpinWheels)
exports.uploadParticipants = asyncHandler(async (req, res) => {
  const { spinWheelId } = req.params;

  if (!spinWheelId) {
    return response(res, 400, "SpinWheel ID is required");
  }

  const wheel = await SpinWheel.findById(spinWheelId).notDeleted();
  if (!wheel) {
    return response(res, 404, "SpinWheel not found");
  }

  if (wheel.type !== "admin") {
    return response(
      res,
      403,
      "Upload participants is only available for admin type SpinWheels"
    );
  }

  if (
    !req.user ||
    (req.user.role !== "admin" && req.user.role !== "superadmin" && req.user.role !== "business")
  ) {
    return response(
      res,
      403,
      "Only admins or business users can upload participants for this SpinWheel."
    );
  }

  if (!req.file) {
    return response(res, 400, "Excel file is required");
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
  });

  if (!rows.length) {
    return response(res, 400, "Uploaded file is empty");
  }

  const hasValidName = rows.some(
    (row) =>
      (row["Name"] && String(row["Name"]).trim()) ||
      (row["name"] && String(row["name"]).trim())
  );

  if (!hasValidName) {
    return response(
      res,
      400,
      "Uploaded file must contain a 'Name' column with at least one participant name"
    );
  }

  response(res, 200, "Upload started", {
    total: rows.length,
  });

  setImmediate(() => {
    uploadProcessor(wheel, rows).catch((err) =>
      console.error("SPINWHEEL UPLOAD PROCESSOR FAILED:", err)
    );
  });
});

// Save Winner
exports.saveWinner = asyncHandler(async (req, res) => {
  const { spinWheelId, participantId } = req.body;

  if (!spinWheelId || !participantId) {
    return response(res, 400, "SpinWheel ID and Participant ID are required");
  }

  const wheel = await SpinWheel.findById(spinWheelId).notDeleted();
  if (!wheel) {
    return response(res, 404, "SpinWheel not found");
  }

  const participant = await SpinWheelParticipant.findById(participantId).notDeleted();
  if (!participant) {
    return response(res, 404, "Participant not found");
  }

  if (participant.spinWheel.toString() !== spinWheelId) {
    return response(res, 400, "Participant does not belong to this SpinWheel");
  }

  const winner = await SpinWheelWinner.createWithAuditUser(
    {
      spinWheel: spinWheelId,
      participant: participantId,
      name: participant.name,
      phone: participant.phone,
      isoCode: participant.isoCode,
      company: participant.company,
    },
    req.user
  );

  return response(res, 201, "Winner saved successfully", winner);
});

// Remove Winner (set visible to false)
exports.removeWinner = asyncHandler(async (req, res) => {
  const { participantId } = req.params;

  if (!participantId) {
    return response(res, 400, "Participant ID is required");
  }

  const participant = await SpinWheelParticipant.findById(participantId).notDeleted();
  if (!participant) {
    return response(res, 404, "Participant not found");
  }

  participant.visible = false;
  participant.setAuditUser(req.user);
  await participant.save();

  return response(res, 200, "Winner removed from wheel successfully", participant);
});

// Get Winners for a SpinWheel
exports.getWinners = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const wheel = await SpinWheel.findOne({ slug }).select("_id").notDeleted();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const winners = await SpinWheelWinner.find({ spinWheel: wheel._id })
    .select("name phone isoCode company createdAt")
    .sort({ createdAt: -1 });

  return response(res, 200, "Winners retrieved successfully", winners);
});
