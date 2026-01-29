const mongoose = require("mongoose");
const XLSX = require("xlsx");
const { formatLocalDateTime } = require("../../utils/dateUtils");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
const Event = require("../../models/Event");
const User = require("../../models/User");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const recountEventRegistrations = require("../../utils/recountEventRegistrations");
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
  emitLoadingProgress,
  emitNewRegistration,
} = require("../../socket/modules/eventreg/eventRegSocket");

const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const { validatePhoneNumberByCountry } = require("../../utils/phoneValidation");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
  DEFAULT_ISO_CODE,
  COUNTRY_CODES,
} = require("../../utils/countryCodes");

const {
  buildRegistrationEmail,
} = require("../../utils/emailTemplateBuilder/eventRegEmailTemplateBuilder");
const sendEmail = require("../../services/emailService");

// PROCESSORS
const uploadProcessor = require("../../processors/eventreg/uploadProcessor");
const emailProcessor = require("../../processors/eventreg/emailProcessor");
const whatsappProcessor = require("../../processors/eventreg/whatsappProcessor");
const { uploadToS3 } = require("../../utils/s3Storage");

function validateUploadedFileFields(event, rows) {
  if (!rows || rows.length === 0) {
    return { valid: false, error: "Uploaded file is empty" };
  }

  const firstRow = rows[0];
  const uploadedFields = Object.keys(firstRow).filter((key) => key !== "Token");

  const hasCustomFields = event.formFields && event.formFields.length > 0;

  if (hasCustomFields) {
    const requiredFields = event.formFields
      .filter((f) => f.required)
      .map((f) => f.inputName);

    const missingRequiredFields = requiredFields.filter(
      (field) => !uploadedFields.includes(field),
    );
    if (missingRequiredFields.length > 0) {
      return {
        valid: false,
        error: `Uploaded file is missing required fields: ${missingRequiredFields.join(
          ", ",
        )}`,
      };
    }

    return { valid: true, error: null };
  } else {
    const classicRequiredFields = ["Full Name", "Email"];

    const missingRequiredFields = classicRequiredFields.filter(
      (field) => !uploadedFields.includes(field),
    );
    if (missingRequiredFields.length > 0) {
      return {
        valid: false,
        error: `Uploaded file is missing required fields: ${missingRequiredFields.join(
          ", ",
        )}`,
      };
    }

    return { valid: true, error: null };
  }
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

async function validateAllRows(event, rows) {
  const invalidRowNumbers = [];
  const invalidEmailRowNumbers = [];
  const duplicateEmailRowNumbers = [];
  const invalidPhoneRowNumbers = [];

  const hasCustomFields = event.formFields && event.formFields.length > 0;

  const allRequiredFields = hasCustomFields
    ? event.formFields.filter((f) => f.required).map((f) => f.inputName)
    : ["Full Name", "Email"];

  const emailOccurrences = {}; // in-file duplicates
  const phoneOccurrences = {};

  // -----------------------------
  // PASS 1: ROW-LEVEL VALIDATION
  // -----------------------------
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    let hasMissingFields = false;
    let hasInvalidEmail = false;

    const extractedEmail = pickEmail(row);
    const extractedPhone = pickPhone(row);

    // ---- Required fields ----
    if (hasCustomFields) {
      for (const field of event.formFields) {
        const value = row[field.inputName];
        if (field.required && (!value || String(value).trim() === "")) {
          hasMissingFields = true;
          break;
        }
      }
    } else {
      if (
        !row["Full Name"] ||
        !row["Email"] ||
        String(row["Email"]).trim() === ""
      ) {
        hasMissingFields = true;
      }
    }

    // ---- Email format ----
    if (extractedEmail && !isValidEmail(extractedEmail)) {
      hasInvalidEmail = true;
    }

    // ---- Track email duplicates (file-level) ----
    if (extractedEmail) {
      const emailKey = extractedEmail.toLowerCase().trim();
      if (!emailOccurrences[emailKey]) emailOccurrences[emailKey] = [];
      emailOccurrences[emailKey].push(rowNumber);
    }

    // ---- Phone normalization + soft validation ----
    if (extractedPhone) {
      const normalized = normalizePhone(extractedPhone);
      const phoneCheck = validatePhoneNumberByCountry(normalized);

      if (!phoneCheck.valid) {
        invalidPhoneRowNumbers.push(rowNumber);
      } else {
        const phoneKey = normalized;
        if (!phoneOccurrences[phoneKey]) phoneOccurrences[phoneKey] = [];
        phoneOccurrences[phoneKey].push(rowNumber);
      }
    }

    if (hasMissingFields) invalidRowNumbers.push(rowNumber);
    if (hasInvalidEmail) invalidEmailRowNumbers.push(rowNumber);
  });

  // -----------------------------
  // FILE-LEVEL DUPLICATE CHECK
  // -----------------------------
  for (const email in emailOccurrences) {
    if (emailOccurrences[email].length > 1) {
      duplicateEmailRowNumbers.push(...emailOccurrences[email]);
    }
  }

  // -----------------------------
  // HARD FAILURES (FILE)
  // -----------------------------
  if (invalidRowNumbers.length > 0) {
    return {
      valid: false,
      error: `Cannot upload file. Row${
        invalidRowNumbers.length > 1 ? "s" : ""
      } ${formatRowNumbers(invalidRowNumbers)} ${
        invalidRowNumbers.length > 1 ? "have" : "has"
      } missing required fields: ${allRequiredFields.join(", ")}.`,
    };
  }

  if (invalidEmailRowNumbers.length > 0) {
    return {
      valid: false,
      error: `Cannot upload file. Row${
        invalidEmailRowNumbers.length > 1 ? "s" : ""
      } ${formatRowNumbers(invalidEmailRowNumbers)} ${
        invalidEmailRowNumbers.length > 1 ? "have" : "has"
      } invalid email format.`,
    };
  }

  if (duplicateEmailRowNumbers.length > 0) {
    return {
      valid: false,
      error: `Cannot upload file. Duplicate email(s) found at row${
        duplicateEmailRowNumbers.length > 1 ? "s" : ""
      } ${formatRowNumbers(duplicateEmailRowNumbers)}. Each email must be unique.`,
    };
  }

  // -----------------------------
  // DB-LEVEL DUPLICATE CHECK
  // -----------------------------
  const emailsInFile = Object.keys(emailOccurrences);
  const phonesInFile = Object.keys(phoneOccurrences);

  if (emailsInFile.length || phonesInFile.length) {
    const existing = await Registration.find({
      eventId: event._id,
      $or: [
        emailsInFile.length ? { email: { $in: emailsInFile } } : null,
        phonesInFile.length ? { phone: { $in: phonesInFile } } : null,
      ].filter(Boolean),
    }).select("email phone");

    if (existing.length > 0) {
      const conflictRows = new Set();

      existing.forEach((reg) => {
        if (reg.email && emailOccurrences[reg.email.toLowerCase()]) {
          emailOccurrences[reg.email.toLowerCase()].forEach((r) =>
            conflictRows.add(r),
          );
        }
        if (reg.phone && phoneOccurrences[reg.phone]) {
          phoneOccurrences[reg.phone].forEach((r) => conflictRows.add(r));
        }
      });

      return {
        valid: false,
        error: `Some rows are already registered for this event: rows ${formatRowNumbers(
          [...conflictRows],
        )}`,
      };
    }
  }

  // -----------------------------
  // SOFT WARNINGS
  // -----------------------------
  return {
    valid: true,
    warning:
      invalidPhoneRowNumbers.length > 0
        ? `Some rows have invalid phone numbers and may not receive WhatsApp messages: rows ${formatRowNumbers(
            invalidPhoneRowNumbers,
          )}`
        : null,
  };
}

// -----------------------------
// Helpers
// -----------------------------
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatRowNumbers(arr) {
  return arr.length === 1
    ? arr[0].toString()
    : arr.length === 2
      ? `${arr[0]} and ${arr[1]}`
      : `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

// Helper for row number formatting
function formatRowNumbers(arr) {
  return arr.length === 1
    ? arr[0].toString()
    : arr.length === 2
      ? `${arr[0]} and ${arr[1]}`
      : `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

// DOWNLOAD sample Excel template
exports.downloadSampleExcel = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  const hasCustomFields = event.formFields && event.formFields.length > 0;
  const formFields = event.formFields || [];

  let headers = [];
  const phoneFields = [];

  if (hasCustomFields) {
    formFields.forEach((f) => {
      headers.push(f.inputName);
      if (
        f.inputType === "phone" ||
        f.inputName?.toLowerCase().includes("phone")
      ) {
        phoneFields.push({ name: f.inputName, index: headers.length - 1 });
      }
    });
  } else {
    headers = ["Full Name", "Email", "Phone", "Company"];
    phoneFields.push({ name: "Phone", index: 2 });
  }

  if (event.requiresApproval) {
    headers.push("Approved");
  }
  headers.push("Token");

  phoneFields.reverse().forEach((phoneField) => {
    const isoCodeHeader = "isoCode";
    headers.splice(phoneField.index, 0, isoCodeHeader);
  });

  const dummyRows = [
    {
      fullName: "User 1",
      email: "user1@gmail.com",
      phone: "1234567890",
      phoneIsoCode: "pk",
      company: "Company 1",
    },
    {
      fullName: "User 2",
      email: "user2@gmail.com",
      phone: "12345678",
      phoneIsoCode: "om",
      company: "Company 2",
    },
    {
      fullName: "User 3",
      email: "user3@gmail.com",
      phone: "1234567890",
      phoneIsoCode: "ca",
      company: "Company 3",
    },
  ];

  const rows = [headers];

  dummyRows.forEach((dummy) => {
    const row = [];
    if (hasCustomFields) {
      formFields.forEach((f) => {
        if (
          f.inputType === "phone" ||
          f.inputName?.toLowerCase().includes("phone")
        ) {
          row.push(dummy.phoneIsoCode);
          row.push(dummy.phone);
        } else if (
          f.inputName?.toLowerCase().includes("name") ||
          f.inputName?.toLowerCase().includes("full")
        ) {
          row.push(dummy.fullName);
        } else if (
          f.inputType === "email" ||
          f.inputName?.toLowerCase().includes("email")
        ) {
          row.push(dummy.email);
        } else if (f.inputName?.toLowerCase().includes("company")) {
          row.push(dummy.company);
        } else {
          row.push("");
        }
      });
    } else {
      row.push(dummy.fullName);
      row.push(dummy.email);
      row.push(dummy.phoneIsoCode);
      row.push(dummy.phone);
      row.push(dummy.company);
    }
    if (event.requiresApproval) {
      const approvedValues = ["yes", "no", ""];
      row.push(approvedValues[rows.length - 1] || "");
    }
    row.push("");
    rows.push(row);
  });

  // Create sample Excel file
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Registrations");
  const sampleBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${slug}_registrations_template.xlsx`,
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(sampleBuffer);
});

// DOWNLOAD country reference Excel file
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

  const countryHeaders = [
    ["Country Name", "ISO Code", "Country Code", "No. of Digits"],
  ];
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
  const countryBuffer = XLSX.write(countryWb, {
    type: "buffer",
    bookType: "xlsx",
  });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=country_reference.xlsx`,
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(countryBuffer);
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
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
  });

  if (!rows.length) {
    return response(res, 400, "Uploaded file is empty");
  }

  const fieldValidation = validateUploadedFileFields(event, rows);
  if (!fieldValidation.valid) {
    return response(
      res,
      400,
      fieldValidation.error ||
        "Uploaded file does not contain required fields.",
    );
  }

  const rowValidation = await validateAllRows(event, rows);
  if (!rowValidation.valid) {
    return response(res, 400, rowValidation.error);
  }

  response(res, 200, "Upload started", {
    total: rows.length,
  });

  setImmediate(() => {
    uploadProcessor(event, rows).catch((err) =>
      console.error("UPLOAD PROCESSOR FAILED:", err),
    );
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
    status,
    emailSent,
    whatsappSent,
    timezone,
    ...dynamicFiltersRaw
  } = req.query;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  const eventId = event._id;
  const hasCustomFields = event.formFields && event.formFields.length > 0;

  // -------------------------
  // PREPARE DB QUERY FILTERS
  // -------------------------
  const mongoQuery = {
    eventId,
    isDeleted: { $ne: true },
  };

  if (status && status !== "all") {
    mongoQuery.approvalStatus = status;
  }

  if (emailSent && emailSent !== "all") {
    if (emailSent === "sent") {
      mongoQuery.emailSent = true;
    } else if (emailSent === "not_sent") {
      mongoQuery.emailSent = { $ne: true };
    }
  }

  if (whatsappSent && whatsappSent !== "all") {
    if (whatsappSent === "sent") {
      mongoQuery.whatsappSent = true;
    } else if (whatsappSent === "not_sent") {
      mongoQuery.whatsappSent = { $ne: true };
    }
  }

  if (token) mongoQuery.token = new RegExp(token, "i");

  // Dynamic field filters
  const classicFieldsMap = {
    "Full Name": "fullName",
    Email: "email",
    Phone: "phone",
    Company: "company",
    fullName: "fullName",
    email: "email",
    phone: "phone",
    company: "company",
  };

  const dynamicFilters = Object.entries(dynamicFiltersRaw)
    .filter(([key]) => key.startsWith("field_"))
    .reduce((acc, [key, val]) => {
      const fieldName = key.replace("field_", "");

      if (hasCustomFields) {
        acc[`customFields.${fieldName}`] = new RegExp(val, "i");
      } else {
        const camelCaseName = classicFieldsMap[fieldName] || fieldName;
        acc[camelCaseName] = new RegExp(val, "i");
      }
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
    regs = regs.filter((r) => {
      const cf = Object.values(r.customFields || {})
        .join(" ")
        .toLowerCase();

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
  walkins.forEach((w) => {
    const id = w.registrationId.toString();
    if (!walkMap[id]) walkMap[id] = [];
    walkMap[id].push(w);
  });

  let filteredRegs = regs;
  if (scannedBy || scannedFrom || scannedTo) {
    filteredRegs = regs.filter((r) => {
      const list = walkMap[r._id.toString()] || [];

      return list.some((w) => {
        if (scannedBy) {
          const match =
            (w.scannedBy?.name || "")
              .toLowerCase()
              .includes(scannedBy.toLowerCase()) ||
            (w.scannedBy?.email || "")
              .toLowerCase()
              .includes(scannedBy.toLowerCase());

          if (!match) return false;
        }

        if (
          scannedFrom &&
          new Date(w.scannedAt) < new Date(Number(scannedFrom))
        ) {
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
    ? event.formFields.map((f) => f.inputName)
    : ["fullName", "email", "phone", "company"];

  // -------------------------
  // CSV START
  // -------------------------
  const lines = [];

  const business = await Business.findById(event.businessId).lean();

  const exportedAt = formatLocalDateTime(Date.now(), timezone || null);

  // Build filters string
  const activeFilters = [];

  if (search) activeFilters.push(`Search: "${search}"`);
  if (token) activeFilters.push(`Token: "${token}"`);
  if (status && status !== "all") {
    const statusLabels = {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
    };
    activeFilters.push(`Status: ${statusLabels[status] || status}`);
  }
  if (emailSent && emailSent !== "all") {
    activeFilters.push(
      `Email Status: ${emailSent === "sent" ? "Sent" : "Not Sent"}`,
    );
  }
  if (whatsappSent && whatsappSent !== "all") {
    activeFilters.push(
      `WhatsApp Status: ${whatsappSent === "sent" ? "Sent" : "Not Sent"}`,
    );
  }
  if (createdFrom || createdTo) {
    const fromStr = createdFrom
      ? formatLocalDateTime(Number(createdFrom), timezone || null)
      : "—";
    const toStr = createdTo
      ? formatLocalDateTime(Number(createdTo), timezone || null)
      : "—";
    activeFilters.push(`Registered At: ${fromStr} to ${toStr}`);
  }
  if (scannedFrom || scannedTo) {
    const fromStr = scannedFrom
      ? formatLocalDateTime(Number(scannedFrom), timezone || null)
      : "—";
    const toStr = scannedTo
      ? formatLocalDateTime(Number(scannedTo), timezone || null)
      : "—";
    activeFilters.push(`Scanned At: ${fromStr} to ${toStr}`);
  }
  if (scannedBy) activeFilters.push(`Scanned By: "${scannedBy}"`);

  // Dynamic field filters
  Object.entries(dynamicFiltersRaw)
    .filter(([key]) => key.startsWith("field_"))
    .forEach(([key, val]) => {
      const fieldName = key.replace("field_", "");
      activeFilters.push(`${fieldName}: "${val}"`);
    });

  const filtersString =
    activeFilters.length > 0 ? activeFilters.join("; ") : "None";

  // HEADER SECTION (RESTORED)
  lines.push(`Event Name,${event.name || "N/A"}`);
  lines.push(`Business Name,${business?.name || "N/A"}`);
  lines.push(`Logo URL,${event.logoUrl || "N/A"}`);
  lines.push(`Event Slug,${event.slug || "N/A"}`);
  lines.push(`Total Registrations,${event.registrations || 0}`);
  lines.push(`Exported Registrations,${regs.length}`);
  lines.push(`Exported At,"${exportedAt}"`);
  lines.push(`Applied Filters,"${filtersString}"`);
  lines.push(""); // spacer

  // -------------------------
  // REGISTRATIONS SECTION
  // -------------------------
  lines.push("=== Registrations ===");

  const regHeaders = [...dynamicFields, "Token", "Registered At"];
  lines.push(regHeaders.join(","));

  regs.forEach((reg) => {
    const row = dynamicFields.map(
      (f) =>
        `"${((reg.customFields?.[f] ?? reg[f] ?? "") + "").replace(
          /"/g,
          '""',
        )}"`,
    );

    row.push(`"${reg.token}"`);
    row.push(`"${formatLocalDateTime(reg.createdAt, timezone || null)}"`);

    lines.push(row.join(","));
  });

  // -------------------------
  // WALK-INS SECTION
  // -------------------------
  const allWalkins = walkins.filter((w) =>
    regs.some((r) => r._id.toString() === w.registrationId.toString()),
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
      "Staff Type",
    ];
    lines.push(wiHeaders.join(","));

    allWalkins.forEach((w) => {
      const reg = regs.find(
        (r) => r._id.toString() === w.registrationId.toString(),
      );

      const row = dynamicFields.map(
        (f) =>
          `"${((reg?.customFields?.[f] ?? reg?.[f] ?? "") + "").replace(
            /"/g,
            '""',
          )}"`,
      );

      row.push(`"${reg.token}"`);
      row.push(`"${formatLocalDateTime(reg.createdAt, timezone || null)}"`);
      row.push(`"${formatLocalDateTime(w.scannedAt, timezone || null)}"`);
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
    `attachment; filename=${event.slug}_filtered_registrations.csv`,
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

  if (event.registrations >= event.capacity)
    return response(res, 400, "Event capacity is full");

  const eventId = event._id;
  const formFields = event.formFields || {};
  const hasCustomFields = formFields.length > 0;

  const customFields = {};

  // ---------- PROCESS CUSTOM FIELDS ----------
  if (hasCustomFields) {
    for (const field of formFields) {
      let value = req.body[field.inputName];

      if (field.required && (!value || String(value).trim() === "")) {
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
            ", ",
          )}`,
        );
      }
      if (value != null) {
        if (field.inputType === "email") {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            return response(
              res,
              400,
              `Invalid email format for ${field.inputName}`,
            );
          }
        }
        customFields[field.inputName] = value;
      }
    }
  }

  // ---------- CANONICAL EXTRACTION ----------
  const extractedEmail = hasCustomFields
    ? pickEmail(customFields)
    : req.body.email;

  const extractedPhone = hasCustomFields
    ? pickPhone(customFields)
    : req.body.phone;

  const extractedFullName = hasCustomFields
    ? pickFullName(customFields)
    : req.body.fullName;

  const extractedCompany = hasCustomFields
    ? pickCompany(customFields)
    : req.body.company;

  if (!hasCustomFields) {
    if (!extractedFullName || !extractedEmail) {
      return response(res, 400, "Full name and email are required");
    }
  }

  // ---------- PHONE NORMALIZATION AND EXTRACTION ----------
  const normalizedPhone = normalizePhone(extractedPhone);

  let phoneIsoCode = req.body.isoCode || null;
  let phoneLocalNumber = null;
  let phoneForValidation = null;
  let phoneForDuplicateCheck = null;

  if (normalizedPhone) {
    phoneLocalNumber = normalizedPhone;
    phoneForValidation = normalizedPhone;

    if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
      phoneForValidation = combinePhoneWithCountryCode(
        normalizedPhone,
        phoneIsoCode,
      );
    } else if (normalizedPhone.startsWith("+")) {
      const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
      if (extracted.isoCode) {
        phoneLocalNumber = extracted.localNumber;
        if (!phoneIsoCode) {
          phoneIsoCode = extracted.isoCode;
        }
        phoneForValidation = normalizedPhone;
      } else if (!phoneIsoCode) {
        phoneIsoCode = DEFAULT_ISO_CODE;
        phoneForValidation =
          combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) ||
          normalizedPhone;
      }
    } else if (!phoneIsoCode) {
      phoneIsoCode = DEFAULT_ISO_CODE;
      phoneForValidation =
        combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) ||
        normalizedPhone;
    } else {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation =
        combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) ||
        normalizedPhone;
    }

    const phoneCheck = validatePhoneNumberByCountry(phoneForValidation);
    if (!phoneCheck.valid) {
      return response(res, 400, phoneCheck.error);
    }

    phoneForDuplicateCheck = phoneForValidation;
  }

  let phoneField = null;
  if (hasCustomFields) {
    phoneField = formFields.find(
      (f) =>
        f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone"),
    );
    if (phoneField && customFields[phoneField.inputName]) {
      customFields[phoneField.inputName] = phoneLocalNumber;
    }
  }

  // ---------- DUPLICATE CHECK ----------
  const duplicateOr = [];

  if (hasCustomFields) {
    const emailField = formFields.find((f) => f.inputType === "email");

    if (emailField && extractedEmail && String(extractedEmail).trim()) {
      duplicateOr.push({
        [`customFields.${emailField.inputName}`]: extractedEmail,
      });
    }
    if (
      phoneField &&
      phoneForDuplicateCheck &&
      String(phoneForDuplicateCheck).trim()
    ) {
      duplicateOr.push({
        [`customFields.${phoneField.inputName}`]: phoneForDuplicateCheck,
      });
      if (phoneLocalNumber && phoneIsoCode) {
        duplicateOr.push({
          $and: [
            { [`customFields.${phoneField.inputName}`]: phoneLocalNumber },
            { isoCode: phoneIsoCode },
          ],
        });
      }
    }
  } else {
    if (extractedEmail && String(extractedEmail).trim())
      duplicateOr.push({ email: extractedEmail });
    if (phoneForDuplicateCheck && String(phoneForDuplicateCheck).trim()) {
      duplicateOr.push({ phone: phoneForDuplicateCheck });
      if (phoneLocalNumber && phoneIsoCode) {
        duplicateOr.push({
          $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }],
        });
      }
    }
  }

  if (duplicateOr.length > 0) {
    const duplicateFilter = {
      eventId,
      $or: duplicateOr,
    };

    const dup = await Registration.findOne(duplicateFilter);
    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  // ---------- CREATE ----------
  const approvalStatus = event.requiresApproval ? "pending" : "approved";

  const newRegistration = await Registration.create({
    eventId,
    fullName: hasCustomFields ? null : extractedFullName,
    email: hasCustomFields ? null : extractedEmail,
    phone: hasCustomFields ? null : phoneLocalNumber,
    isoCode: hasCustomFields ? null : phoneIsoCode,
    company: hasCustomFields ? null : extractedCompany,
    customFields,
    approvalStatus,
  });

  await recountEventRegistrations(eventId);

  // --- Generate and send email using util ---
  const emailForSending =
    formFields.length > 0 ? pickEmail(customFields) : extractedEmail;
  const displayNameForEmail =
    formFields.length > 0
      ? pickFullName(customFields) ||
        (event.defaultLanguage === "ar" ? "ضيف" : "Guest")
      : extractedFullName || (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

  const { subject, html, qrCodeDataUrl } = await buildRegistrationEmail({
    event,
    registration: newRegistration,
    displayName: displayNameForEmail,
    customFields,
  });

  if (emailForSending) {
    const result = await sendEmail(
      emailForSending,
      subject,
      html,
      qrCodeDataUrl,
      event.agendaUrl
        ? [{ filename: "Agenda.pdf", path: event.agendaUrl }]
        : [],
    );
    if (result.success) {
      newRegistration.emailSent = true;
      await newRegistration.save();
    } else {
      console.error(
        `Email failed for ${emailForSending}:`,
        result.response || result.error,
      );
    }
  }

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  const enhancedRegistration = {
    _id: newRegistration._id,
    token: newRegistration.token,
    emailSent: newRegistration.emailSent,
    whatsappSent: newRegistration.whatsappSent,
    createdAt: newRegistration.createdAt,
    approvalStatus: newRegistration.approvalStatus,
    fullName: newRegistration.fullName,
    email: newRegistration.email,
    phone: newRegistration.phone,
    company: newRegistration.company,
    customFields: newRegistration.customFields || {},
    walkIns: [],
  };

  emitNewRegistration(event._id.toString(), enhancedRegistration);

  return response(res, 201, "Registration successful", newRegistration);
});

// UPDATE registration (Admin/Staff editable)
exports.updateRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { fields } = req.body;

  const reg = await Registration.findById(id).populate("eventId");
  if (!reg) return response(res, 404, "Registration not found");

  const event = reg.eventId;
  const hasCustomFields = event.formFields?.length > 0;

  // ---------- APPLY UPDATES ----------
  if (hasCustomFields) {
    const phoneField = event.formFields.find(
      (f) =>
        f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone"),
    );

    const updatedCustomFields = {
      ...Object.fromEntries(reg.customFields || []),
      ...fields,
    };

    if (phoneField && updatedCustomFields[phoneField.inputName]) {
      const phoneValue = normalizePhone(
        updatedCustomFields[phoneField.inputName],
      );
      if (phoneValue && phoneValue.startsWith("+")) {
        const extracted = extractCountryCodeAndIsoCode(phoneValue);
        if (extracted.isoCode) {
          updatedCustomFields[phoneField.inputName] = extracted.localNumber;
          reg.isoCode = fields.isoCode || extracted.isoCode;
        } else {
          reg.isoCode = fields.isoCode || reg.isoCode || DEFAULT_ISO_CODE;
        }
      } else {
        reg.isoCode = fields.isoCode || reg.isoCode || DEFAULT_ISO_CODE;
      }
    } else {
      reg.isoCode = fields.isoCode || reg.isoCode;
    }

    reg.customFields = updatedCustomFields;
    reg.fullName = null;
    reg.email = null;
    reg.phone = null;
    reg.company = null;
  } else {
    reg.fullName = fields.fullName ?? fields["Full Name"] ?? reg.fullName;
    reg.email = fields.email ?? fields.Email ?? reg.email;
    const phoneRaw = fields.phone ?? fields.Phone;
    if (phoneRaw !== undefined) {
      reg.phone = phoneRaw;
    }
    reg.company = fields.company ?? fields.Company ?? reg.company;
    reg.customFields = {};
  }

  // ---------- CANONICAL EXTRACTION ----------
  const extractedEmail = hasCustomFields
    ? pickEmail(reg.customFields)
    : reg.email;

  const extractedPhone = hasCustomFields
    ? pickPhone(reg.customFields)
    : reg.phone;

  let normalizedPhone = null;
  let phoneLocalNumber = null;
  let phoneIsoCode = null;
  let phoneForDuplicateCheck = null;

  if (extractedPhone) {
    normalizedPhone = normalizePhone(extractedPhone);

    phoneIsoCode = fields.isoCode || reg.isoCode || null;
    let phoneForValidation = normalizedPhone;

    if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(
        normalizedPhone,
        phoneIsoCode,
      );
    } else if (normalizedPhone.startsWith("+")) {
      const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
      if (extracted.isoCode) {
        phoneLocalNumber = extracted.localNumber;
        if (!phoneIsoCode) {
          phoneIsoCode = extracted.isoCode;
        }
        phoneForValidation = normalizedPhone;
      } else if (!phoneIsoCode) {
        phoneIsoCode = DEFAULT_ISO_CODE;
        phoneForValidation =
          combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) ||
          normalizedPhone;
      }
    } else if (!phoneIsoCode) {
      phoneIsoCode = reg.isoCode || DEFAULT_ISO_CODE;
      phoneLocalNumber = normalizedPhone;
      phoneForValidation =
        combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) ||
        normalizedPhone;
    } else {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation =
        combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) ||
        normalizedPhone;
    }

    const phoneCheck = validatePhoneNumberByCountry(phoneForValidation);
    if (!phoneCheck.valid) {
      return response(res, 400, phoneCheck.error);
    }

    phoneForDuplicateCheck = phoneForValidation;

    if (!hasCustomFields) {
      if (phoneLocalNumber !== null) {
        reg.phone = phoneLocalNumber;
      }
      if (phoneIsoCode) {
        reg.isoCode = phoneIsoCode;
      }
    } else {
      const phoneField = event.formFields.find(
        (f) =>
          f.inputType === "phone" ||
          f.inputName?.toLowerCase().includes("phone"),
      );
      if (phoneField && phoneLocalNumber !== null) {
        const updatedCustomFields = {
          ...Object.fromEntries(reg.customFields || []),
          [phoneField.inputName]: phoneLocalNumber,
        };
        reg.customFields = updatedCustomFields;
      }
      if (phoneIsoCode) {
        reg.isoCode = phoneIsoCode;
      }
    }
  } else {
    if (!hasCustomFields && fields.isoCode) {
      reg.isoCode = fields.isoCode;
    }
  }

  // ---------- DUPLICATE CHECK ----------
  if (extractedEmail || phoneForDuplicateCheck) {
    const duplicateOr = [];

    if (hasCustomFields) {
      const emailField = event.formFields.find((f) => f.inputType === "email");
      const phoneField = event.formFields.find(
        (f) =>
          f.inputType === "phone" ||
          f.inputName?.toLowerCase().includes("phone"),
      );

      if (emailField && extractedEmail) {
        duplicateOr.push({
          [`customFields.${emailField.inputName}`]: extractedEmail,
        });
      }
      if (phoneField && phoneForDuplicateCheck) {
        duplicateOr.push({
          [`customFields.${phoneField.inputName}`]: phoneForDuplicateCheck,
        });
        if (phoneLocalNumber && phoneIsoCode) {
          duplicateOr.push({
            $and: [
              { [`customFields.${phoneField.inputName}`]: phoneLocalNumber },
              { isoCode: phoneIsoCode },
            ],
          });
        }
      }
      if (extractedEmail) duplicateOr.push({ email: extractedEmail });
      if (phoneForDuplicateCheck) {
        duplicateOr.push({ phone: phoneForDuplicateCheck });
        if (phoneLocalNumber && phoneIsoCode) {
          duplicateOr.push({
            $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }],
          });
        }
      }
    } else {
      if (extractedEmail) duplicateOr.push({ email: extractedEmail });
      if (phoneForDuplicateCheck) {
        duplicateOr.push({ phone: phoneForDuplicateCheck });
        if (phoneLocalNumber && phoneIsoCode) {
          duplicateOr.push({
            $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }],
          });
        }
      }
    }

    const duplicateFilter = {
      eventId: event._id,
      _id: { $ne: reg._id },
      ...(duplicateOr.length > 0 ? { $or: duplicateOr } : {}),
    };

    const dup = await Registration.findOne(duplicateFilter);
    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  await reg.save();
  return response(res, 200, "Registration updated successfully", reg);
});

// UPDATE registration approval status
exports.updateRegistrationApproval = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  const validStatuses = ["pending", "approved", "rejected"];
  if (!status || !validStatuses.includes(status)) {
    return response(
      res,
      400,
      `Status must be one of: ${validStatuses.join(", ")}`,
    );
  }

  const registration = await Registration.findById(id).populate("eventId");
  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  if (!registration.eventId?.requiresApproval) {
    return response(res, 400, "This event does not require approval");
  }

  registration.approvalStatus = status;
  await registration.save();

  recomputeAndEmit(registration.eventId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(
    res,
    200,
    "Registration approval status updated",
    registration,
  );
});

// BULK update registration approval status
exports.bulkUpdateRegistrationApproval = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { status, filters = {} } = req.body;

  const validStatuses = ["pending", "approved", "rejected"];
  if (!status || !validStatuses.includes(status)) {
    return response(
      res,
      400,
      `Status must be one of: ${validStatuses.join(", ")}`,
    );
  }

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");

  if (!event.requiresApproval) {
    return response(res, 400, "This event does not require approval");
  }

  // ------------------------------------------------
  // Build Mongo query from filters (same as export)
  // ------------------------------------------------
  const query = {
    eventId: event._id,
    isDeleted: { $ne: true },
  };

  // Text search
  if (filters.search) {
    const search = filters.search;
    const regex = new RegExp(search, "i");

    query.$or = [
      // Fixed schema fields
      { fullName: regex },
      { email: regex },
      { phone: regex },
      { company: regex },
      { token: regex },

      // Dynamic custom fields
      {
        $expr: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $objectToArray: "$customFields" },
                  as: "cf",
                  cond: {
                    $regexMatch: {
                      input: { $toString: "$$cf.v" },
                      regex: search,
                      options: "i",
                    },
                  },
                },
              },
            },
            0,
          ],
        },
      },
    ];
  }

  // Token
  if (filters.token) {
    query.token = filters.token;
  }

  // Approval status
  if (filters.status) {
    query.approvalStatus = filters.status;
  }

  // Email / WhatsApp status
  if (filters.emailSent !== undefined) {
    query.emailSent = filters.emailSent === "sent";
  }
  if (filters.whatsappSent !== undefined) {
    query.whatsappSent = filters.whatsappSent === "sent";
  }

  // Created date range
  if (filters.createdFrom || filters.createdTo) {
    query.createdAt = {};
    if (filters.createdFrom)
      query.createdAt.$gte = new Date(Number(filters.createdFrom));
    if (filters.createdTo)
      query.createdAt.$lte = new Date(Number(filters.createdTo));
  }

  // Walk-in filters
  if (filters.scannedBy) {
    query["walkIns.scannedBy.name"] = {
      $regex: filters.scannedBy,
      $options: "i",
    };
  }

  if (filters.scannedFrom || filters.scannedTo) {
    query.walkIns = {
      $elemMatch: {},
    };

    if (filters.scannedFrom) {
      query.walkIns.$elemMatch.scannedAt = {
        $gte: new Date(Number(filters.scannedFrom)),
      };
    }
    if (filters.scannedTo) {
      query.walkIns.$elemMatch.scannedAt = {
        ...(query.walkIns.$elemMatch.scannedAt || {}),
        $lte: new Date(Number(filters.scannedTo)),
      };
    }
  }

  // Dynamic custom fields: field_<name>
  Object.entries(filters).forEach(([key, value]) => {
    if (!key.startsWith("field_")) return;
    if (!value) return;

    const fieldName = key.replace("field_", "");
    query[`customFields.${fieldName}`] = value;
  });

  // ------------------------------------------------
  // Perform bulk update
  // ------------------------------------------------
  const result = await Registration.updateMany(query, {
    $set: { approvalStatus: status },
  });

  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(res, 200, "Bulk approval status updated", {
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
    status,
  });
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
  const { subject, body, statusFilter, emailSentFilter, whatsappSentFilter } =
    req.body;
  const event = await Event.findOne({ slug }).lean();
  if (!event) return response(res, 404, "Event not found");

  const business = await Business.findById(event.businessId).lean();

  let mediaUrl = null;
  let originalFilename = null;
  if (req.file) {
    const { fileUrl } = await uploadToS3(
      req.file,
      business.slug,
      "EventReg/custom-attachments",
      { inline: true },
    );
    mediaUrl = fileUrl;
    originalFilename = req.file.originalname;
  }

  let filterQuery = {
    eventId: event._id,
    isDeleted: { $ne: true },
  };

  if (statusFilter && statusFilter !== "all") {
    if (statusFilter === "approved") {
      filterQuery.approvalStatus = "approved";
    } else if (statusFilter === "rejected") {
      filterQuery.approvalStatus = "rejected";
    } else if (statusFilter === "pending") {
      filterQuery.approvalStatus = "pending";
    }
  }

  if (emailSentFilter && emailSentFilter !== "all") {
    if (emailSentFilter === "sent") {
      filterQuery.emailSent = true;
    } else if (emailSentFilter === "notSent") {
      filterQuery.emailSent = { $ne: true };
    }
  }

  if (whatsappSentFilter && whatsappSentFilter !== "all") {
    if (whatsappSentFilter === "sent") {
      filterQuery.whatsappSent = true;
    } else if (whatsappSentFilter === "notSent") {
      filterQuery.whatsappSent = { $ne: true };
    }
  }

  const regs = await Registration.find(filterQuery)
    .select(
      "fullName email phone company customFields token emailSent whatsappSent createdAt approvalStatus",
    )
    .lean();

  // Early response immediately
  response(res, 200, "Bulk notification job started", {
    total: regs.length,
  });

  // Background processor
  setImmediate(() => {
    const customEmail =
      subject && body ? { subject, body, mediaUrl, originalFilename } : null;
    emailProcessor(event, regs, customEmail).catch((err) =>
      console.error("EMAIL PROCESSOR FAILED:", err),
    );
  });
});

// -------------------------------------------
// BULK WHATSAPP SEND (Early Response + Background Job)
// -------------------------------------------
exports.sendBulkWhatsApp = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const {
    type,
    subject,
    body,
    statusFilter,
    emailSentFilter,
    whatsappSentFilter,
  } = req.body;

  const event = await Event.findOne({ slug }).lean();
  if (!event) return response(res, 404, "Event not found");

  const business = await Business.findById(event.businessId).lean();

  let mediaUrl = null;
  if (req.file) {
    const { fileUrl } = await uploadToS3(
      req.file,
      business.slug,
      "EventReg/custom-attachments",
      { inline: true },
    );
    mediaUrl = fileUrl;
  }

  let filterQuery = {
    eventId: event._id,
    isDeleted: { $ne: true },
  };

  // Apply status filter - only if not "all" or undefined
  if (statusFilter && statusFilter !== "all") {
    if (statusFilter === "approved") {
      filterQuery.approvalStatus = "approved";
    } else if (statusFilter === "rejected") {
      filterQuery.approvalStatus = "rejected";
    } else if (statusFilter === "pending") {
      filterQuery.approvalStatus = "pending";
    }
  }

  // Apply email sent filter - only if not "all" or undefined
  if (emailSentFilter && emailSentFilter !== "all") {
    if (emailSentFilter === "sent") {
      filterQuery.emailSent = true;
    } else if (emailSentFilter === "notSent") {
      filterQuery.emailSent = { $ne: true };
    }
  }

  // Apply WhatsApp sent filter - only if not "all" or undefined
  if (whatsappSentFilter && whatsappSentFilter !== "all") {
    if (whatsappSentFilter === "sent") {
      filterQuery.whatsappSent = true;
    } else if (whatsappSentFilter === "notSent") {
      filterQuery.whatsappSent = { $ne: true };
    }
  }

  const regs = await Registration.find(filterQuery)
    .select(
      "fullName email phone company customFields token emailSent whatsappSent createdAt approvalStatus isoCode",
    )
    .lean();

  response(res, 200, "Bulk notification job started", {
    total: regs.length,
  });

  setImmediate(() => {
    if (type === "custom") {
      const customWhatsAppProcessor = require("../../processors/eventreg/customWhatsAppProcessor");
      customWhatsAppProcessor(event, regs, { subject, body, mediaUrl }).catch(
        (err) =>
          console.error("EVENTREG CUSTOM WHATSAPP PROCESSOR FAILED:", err),
      );
    } else {
      whatsappProcessor(event, regs).catch((err) =>
        console.error("EVENTREG WHATSAPP PROCESSOR FAILED:", err),
      );
    }
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

  // **Always fix the count before returning list**
  await recountEventRegistrations(eventId);

  // Use consistent soft-delete filter
  const totalRegistrations = await Registration.countDocuments({
    eventId,
    isDeleted: { $ne: true },
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
        whatsappSent: reg.whatsappSent,
        createdAt: reg.createdAt,

        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        isoCode: reg.isoCode,
        company: reg.company,

        customFields: reg.customFields || {},

        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    }),
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
        .where("isDeleted")
        .ne(true)
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
            whatsappSent: reg.whatsappSent,
            createdAt: reg.createdAt,
            approvalStatus: reg.approvalStatus,
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
        }),
      );

      const currentLoaded = skip + enhanced.length;
      emitLoadingProgress(eventId.toString(), currentLoaded, total, enhanced);

      await new Promise((resolve) => setTimeout(resolve, 100));
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
  await recountEventRegistrations(eventId);
  const totalCount = await Registration.countDocuments({
    eventId,
    isDeleted: { $ne: true },
  });

  // Return first 50 records immediately
  const registrations = await Registration.find({ eventId })
    .where("isDeleted")
    .ne(true)
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
        whatsappSent: reg.whatsappSent,
        createdAt: reg.createdAt,
        approvalStatus: reg.approvalStatus,
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        isoCode: reg.isoCode,
        company: reg.company,
        customFields: reg.customFields || {},
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    }),
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

  const registration = await Registration.findOne({ token })
    .populate("eventId")
    .notDeleted();
  if (!registration) return response(res, 404, "Registration not found");

  const eventBusinessId = registration.eventId?.businessId?.toString();
  const staffBusinessId = staffUser.business?.toString();

  if (!staffBusinessId || staffBusinessId !== eventBusinessId) {
    return response(
      res,
      403,
      "You are not authorized to scan registrations for this business",
    );
  }

  if (registration.eventId?.requiresApproval) {
    if (registration.approvalStatus !== "approved") {
      return response(res, 200, "This registration is not approved", {
        notApproved: true,
        approvalStatus: registration.approvalStatus,
      });
    }
  }

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
    console.error("Background recompute failed:", err.message),
  );

  return response(res, 200, "Registration verified and walk-in recorded", {
    ...normalized,
    eventName: registration.eventId?.name || "Unknown Event",
    eventId: registration.eventId?._id,
    showQrOnBadge: registration.eventId?.showQrOnBadge,
    requiresApproval: registration.eventId?.requiresApproval || false,
    createdAt: registration.createdAt,
    walkinId: walkin._id,
    scannedAt: walkin.scannedAt,
    scannedBy: { name: staffUser.name || staffUser.email },
    zpl,
  });
});

// Create walkin record for a registration (Admin use)
exports.createWalkIn = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminUser = req.user;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  if (!adminUser?.id) {
    return response(res, 401, "Unauthorized – no admin info");
  }

  const userDoc = await User.findById(adminUser.id).notDeleted();
  if (!userDoc) {
    return response(res, 404, "User not found");
  }

  const allowedRoles = ["admin", "business"];
  if (!allowedRoles.includes(userDoc.role)) {
    return response(
      res,
      403,
      `Only admin or business users can create walk-in records. Your role: ${userDoc.role}`,
    );
  }

  const registration = await Registration.findById(id)
    .populate("eventId")
    .notDeleted();

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  if (registration.eventId?.requiresApproval) {
    if (registration.approvalStatus !== "approved") {
      return response(res, 400, "This registration is not approved");
    }
  }

  const walkin = new WalkIn({
    registrationId: registration._id,
    eventId: registration.eventId?._id,
    scannedBy: adminUser.id,
  });
  await walkin.save();

  recomputeAndEmit(registration.eventId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(res, 200, "Walk-in record created successfully", {
    walkinId: walkin._id,
    scannedAt: walkin.scannedAt,
    scannedBy: {
      name: adminUser.name || adminUser.email,
      id: adminUser.id,
    },
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
  await recountEventRegistrations(registration.eventId);

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(res, 200, "Registration moved to recycle bin");
});

// Restore single registration
exports.restoreRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  const event = await Event.findById(reg.eventId).lean();
  if (!event) return response(res, 404, "Associated event not found");

  await reg.restore();
  await recountEventRegistrations(event._id);

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
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
    await recountEventRegistrations(reg.eventId);
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(res, 200, `Restored ${regs.length} registrations`);
});

// Permanent delete single registration
exports.permanentDeleteRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({
    _id: req.params.id,
  }).populate("eventId", "businessId");

  if (!reg) return response(res, 404, "Registration not found in trash");

  const businessId = reg.eventId?.businessId || null;

  await reg.deleteOne();
  await recountEventRegistrations(reg.eventId._id);

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(res, 200, "Registration permanently deleted");
});

// PERMANENT DELETE ALL public registrations (cascade walk-ins)
exports.permanentDeleteAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length) {
    return response(res, 404, "No registrations found in trash to delete");
  }

  const eventId = regs[0].eventId;

  const regIds = regs.map((r) => r._id);

  await WalkIn.deleteMany({ registrationId: { $in: regIds } });
  const result = await Registration.deleteManyDeleted();

  await recountEventRegistrations(eventId);
  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(
    res,
    200,
    `Permanently deleted ${result.deletedCount} registrations and their walk-ins`,
  );
});
