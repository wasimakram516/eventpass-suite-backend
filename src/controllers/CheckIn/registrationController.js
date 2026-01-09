const mongoose = require("mongoose");
const XLSX = require("xlsx");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const WalkIn = require("../../models/WalkIn");
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
  emitPresenceConfirmed,
} = require("../../socket/modules/checkin/checkInSocket");
const uploadProcessor = require("../../processors/checkin/uploadProcessor");
const emailProcessor = require("../../processors/checkin/emailProcessor");
const whatsappProcessor = require("../../processors/checkin/whatsappProcessor");
const { formatLocalDateTime } = require("../../utils/dateUtils");
const { uploadToS3 } = require("../../utils/s3Storage");
const {
  normalizePhone,
  validatePhoneNumber,
} = require("../../utils/whatsappProcessorUtils");
const { validatePhoneNumberByCountry } = require("../../utils/phoneValidation");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
  DEFAULT_ISO_CODE,
  COUNTRY_CODES,
} = require("../../utils/countryCodes");

const ALLOWED_EVENT_TYPE = "closed";

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
      (field) => !uploadedFields.includes(field)
    );
    if (missingRequiredFields.length > 0) {
      return {
        valid: false,
        error: `Uploaded file is missing required fields: ${missingRequiredFields.join(
          ", "
        )}`,
      };
    }

    return { valid: true, error: null };
  } else {
    const classicRequiredFields = ["Full Name", "Email"];

    const missingRequiredFields = classicRequiredFields.filter(
      (field) => !uploadedFields.includes(field)
    );
    if (missingRequiredFields.length > 0) {
      return {
        valid: false,
        error: `Uploaded file is missing required fields: ${missingRequiredFields.join(
          ", "
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

function formatRowNumbers(arr) {
  return arr.length === 1
    ? arr[0].toString()
    : arr.length === 2
      ? `${arr[0]} and ${arr[1]}`
      : `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

function validateAllRows(event, rows) {
  const invalidRowNumbers = [];
  const invalidEmailRowNumbers = [];
  const invalidPhoneRowNumbers = [];
  const duplicateEmailRowNumbers = [];

  const hasCustomFields = event.formFields && event.formFields.length > 0;

  let allRequiredFields = hasCustomFields
    ? event.formFields.filter((f) => f.required).map((f) => f.inputName)
    : ["Full Name", "Email"];

  const emailOccurrences = {};

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    let hasMissingFields = false;
    let hasInvalidEmail = false;

    let extractedEmail = null;
    let extractedPhone = null;

    if (hasCustomFields) {
      extractedEmail = pickEmail(row);
      extractedPhone = pickPhone(row);

      for (const field of event.formFields) {
        if (field.required) {
          const value = row[field.inputName];
          if (!value || String(value).trim() === "") {
            hasMissingFields = true;
            break;
          }
        }
      }
    } else {
      extractedEmail = row["Email"];
      extractedPhone = row["Phone"];

      if (
        !row["Full Name"] ||
        !row["Email"] ||
        String(row["Email"]).trim() === ""
      ) {
        hasMissingFields = true;
      }
    }

    // ---------- EMAIL VALIDATION ----------
    if (extractedEmail) {
      if (!isValidEmail(extractedEmail)) {
        hasInvalidEmail = true;
      } else {
        const emailLower = extractedEmail.toString().trim().toLowerCase();
        if (!emailOccurrences[emailLower]) emailOccurrences[emailLower] = [];
        emailOccurrences[emailLower].push(rowNumber);
      }
    }

    // ---------- PHONE NORMALIZATION + VALIDATION (SOFT) ----------
    if (extractedPhone) {
      const normalized = normalizePhone(extractedPhone);
      const phoneCheck = validatePhoneNumberByCountry(normalized);

      if (!phoneCheck.valid) {
        invalidPhoneRowNumbers.push(rowNumber);
      } else {
        // write back normalized phone so downstream processors get clean data
        if (hasCustomFields) {
          for (const key of Object.keys(row)) {
            if (row[key] === extractedPhone) {
              row[key] = normalized;
              break;
            }
          }
        } else {
          row["Phone"] = normalized;
        }
      }
    }

    if (hasMissingFields) invalidRowNumbers.push(rowNumber);
    if (hasInvalidEmail) invalidEmailRowNumbers.push(rowNumber);
  });

  // ---------- DUPLICATE EMAILS ----------
  for (const email in emailOccurrences) {
    if (emailOccurrences[email].length > 1) {
      duplicateEmailRowNumbers.push(...emailOccurrences[email]);
    }
  }

  // ---------- HARD FAILURES ----------
  if (invalidRowNumbers.length > 0) {
    return {
      valid: false,
      error: `Cannot upload file. Row(s) ${formatRowNumbers(
        invalidRowNumbers
      )} missing required fields: ${allRequiredFields.join(", ")}.`,
    };
  }

  if (invalidEmailRowNumbers.length > 0) {
    return {
      valid: false,
      error: `Cannot upload file. Row(s) ${formatRowNumbers(
        invalidEmailRowNumbers
      )} have invalid email format.`,
    };
  }

  if (duplicateEmailRowNumbers.length > 0) {
    return {
      valid: false,
      error: `Cannot upload file. Duplicate email(s) found at row(s) ${formatRowNumbers(
        duplicateEmailRowNumbers
      )}.`,
    };
  }

  // PHONE ERRORS ARE NOT BLOCKING
  return {
    valid: true,
    warnings:
      invalidPhoneRowNumbers.length > 0
        ? `Some rows have invalid phone numbers and may not receive WhatsApp messages: rows ${formatRowNumbers(
          invalidPhoneRowNumbers
        )}`
        : null,
  };
}

// Download sample template
exports.downloadSampleExcel = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  if (!slug) return response(res, 400, "Event slug is required");

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 404, "Event not found");
  }

  const hasCustomFields = event.formFields && event.formFields.length > 0;
  const formFields = event.formFields || [];

  // Build headers and identify phone fields
  let headers = [];
  const phoneFields = [];

  if (hasCustomFields) {
    formFields.forEach((f) => {
      headers.push(f.inputName);
      if (f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")) {
        phoneFields.push({ name: f.inputName, index: headers.length - 1 });
      }
    });
  } else {
    headers = ["Full Name", "Email", "Phone", "Company"];
    phoneFields.push({ name: "Phone", index: 2 });
  }
  headers.push("Token");

  // Insert isoCode columns before each phone field (from right to left to maintain indices)
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
        if (f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")) {
          row.push(dummy.phoneIsoCode);
          row.push(dummy.phone);
        } else if (f.inputName?.toLowerCase().includes("name") || f.inputName?.toLowerCase().includes("full")) {
          row.push(dummy.fullName);
        } else if (f.inputType === "email" || f.inputName?.toLowerCase().includes("email")) {
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
    `attachment; filename=${slug}_registrations_template.xlsx`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

// Upload registrations (background)
exports.uploadRegistrations = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  if (!slug) return response(res, 400, "Event Slug is required");

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 404, "Event not found");
  }

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
      fieldValidation.error || "Uploaded file does not contain required fields."
    );
  }

  const rowValidation = validateAllRows(event, rows);
  if (!rowValidation.valid) {
    return response(res, 400, rowValidation.error);
  }

  response(res, 200, "Upload started", {
    total: rows.length,
  });

  setImmediate(() => {
    uploadProcessor(event, rows).catch((err) =>
      console.error("CHECKIN UPLOAD PROCESSOR FAILED:", err)
    );
  });
});

// GET initial registrations (first 50) and start background loading
exports.getAllCheckInRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 404, "Closed event not found");
  }

  const eventId = event._id;

  const initialRegs = await Registration.find({ eventId })
    .notDeleted()
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const enhanced = await Promise.all(
    initialRegs.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email staffType")
        .sort({ scannedAt: -1 })
        .lean();

      return {
        ...reg,
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

  emitLoadingProgress(
    eventId.toString(),
    enhanced.length,
    enhanced.length,
    enhanced
  );

  setImmediate(async () => {
    const total = await Registration.countDocuments({ eventId }).notDeleted();
    const batchSize = 200;
    let loaded = 0;

    for (let skip = 0; skip < total; skip += batchSize) {
      const regs = await Registration.find({ eventId })
        .notDeleted()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(batchSize)
        .lean();

      const enhancedRegs = await Promise.all(
        regs.map(async (reg) => {
          const walkIns = await WalkIn.find({ registrationId: reg._id })
            .populate("scannedBy", "name email staffType")
            .sort({ scannedAt: -1 })
            .lean();

          return {
            ...reg,
            walkIns: walkIns.map((w) => ({
              scannedAt: w.scannedAt,
              scannedBy: w.scannedBy,
            })),
          };
        })
      );

      loaded += enhancedRegs.length;
      emitLoadingProgress(eventId.toString(), loaded, total, enhancedRegs);
    }
  });

  return response(res, 200, "Initial registrations fetched", {
    data: enhanced,
    total: await Registration.countDocuments({ eventId }).notDeleted(),
    loaded: enhanced.length,
  });
});

// GET paginated registrations by event using slug
exports.getRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 404, "Closed event not found");
  }

  const eventId = event._id;

  const totalRegistrations = await Registration.countDocuments({
    eventId,
    isDeleted: { $ne: true },
  });

  const registrations = await Registration.find({ eventId })
    .notDeleted()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  return response(res, 200, "Registrations fetched", {
    data: registrations,
    pagination: {
      totalRegistrations,
      totalPages: Math.ceil(totalRegistrations / limit) || 1,
      currentPage: Number(page),
      perPage: Number(limit),
    },
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
  if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 404, "Event not found");
  }

  const eventId = event._id;
  const hasCustomFields = event.formFields && event.formFields.length > 0;

  const mongoQuery = {
    eventId,
    isDeleted: { $ne: true },
  };

  /* ---------- STATUS FILTER ---------- */
  if (status && status !== "all") {
    mongoQuery.approvalStatus = status;
  }

  /* ---------- EMAIL SENT FILTER ---------- */
  if (emailSent && emailSent !== "all") {
    if (emailSent === "sent") {
      mongoQuery.emailSent = true;
    } else if (emailSent === "not_sent") {
      mongoQuery.emailSent = { $ne: true };
    }
  }

  /* ---------- WHATSAPP SENT FILTER ---------- */
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

  if (createdFrom || createdTo) {
    mongoQuery.createdAt = {};
    if (createdFrom) mongoQuery.createdAt.$gte = new Date(Number(createdFrom));
    if (createdTo) mongoQuery.createdAt.$lte = new Date(Number(createdTo));
  }

  let regs = await Registration.find(mongoQuery).lean();

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
  const dynamicFields = event.formFields?.length
    ? event.formFields.map((f) => f.inputName)
    : ["fullName", "email", "phone", "company"];

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
      confirmed: "Confirmed",
      not_attending: "Not Attending",
    };
    activeFilters.push(`Status: ${statusLabels[status] || status}`);
  }
  if (emailSent && emailSent !== "all") {
    activeFilters.push(
      `Email Status: ${emailSent === "sent" ? "Sent" : "Not Sent"}`
    );
  }
  if (whatsappSent && whatsappSent !== "all") {
    activeFilters.push(
      `WhatsApp Status: ${whatsappSent === "sent" ? "Sent" : "Not Sent"}`
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

  lines.push(`Event Name,${event.name || "N/A"}`);
  lines.push(`Business Name,${business?.name || "N/A"}`);
  lines.push(`Logo URL,${event.logoUrl || "N/A"}`);
  lines.push(`Event Slug,${event.slug || "N/A"}`);
  lines.push(`Total Registrations,${event.registrations || 0}`);
  lines.push(`Exported Registrations,${regs.length}`);
  lines.push(`Exported At,"${exportedAt}"`);
  lines.push(`Applied Filters,"${filtersString}"`);
  lines.push("");

  lines.push("=== Registrations ===");

  const regHeaders = [
    ...dynamicFields,
    "Token",
    "Status",
    "Registered At",
    "Confirmed At",
  ];
  lines.push(regHeaders.join(","));

  regs.forEach((reg) => {
    const row = dynamicFields.map(
      (f) =>
        `"${((reg.customFields?.[f] ?? reg[f] ?? "") + "").replace(
          /"/g,
          '""'
        )}"`
    );

    row.push(`"${reg.token}"`);
    row.push(`"${reg.approvalStatus || "pending"}"`);
    row.push(`"${formatLocalDateTime(reg.createdAt, timezone || null)}"`);
    row.push(
      `"${reg.confirmedAt
        ? formatLocalDateTime(reg.confirmedAt, timezone || null)
        : "N/A"
      }"`
    );

    lines.push(row.join(","));
  });

  const allWalkins = walkins.filter((w) =>
    regs.some((r) => r._id.toString() === w.registrationId.toString())
  );

  if (allWalkins.length > 0) {
    lines.push("");
    lines.push("=== Walk-ins ===");

    const wiHeaders = [
      ...dynamicFields,
      "Token",
      "Status",
      "Registered At",
      "Confirmed At",
      "Scanned At",
      "Scanned By",
      "Staff Type",
    ];
    lines.push(wiHeaders.join(","));

    allWalkins.forEach((w) => {
      const reg = regs.find(
        (r) => r._id.toString() === w.registrationId.toString()
      );

      const row = dynamicFields.map(
        (f) =>
          `"${((reg?.customFields?.[f] ?? reg?.[f] ?? "") + "").replace(
            /"/g,
            '""'
          )}"`
      );

      row.push(`"${reg.token}"`);
      row.push(`"${reg?.approvalStatus || "pending"}"`);
      row.push(`"${formatLocalDateTime(reg.createdAt, timezone || null)}"`);
      row.push(
        `"${reg?.confirmedAt
          ? formatLocalDateTime(reg.confirmedAt, timezone || null)
          : "N/A"
        }"`
      );
      row.push(`"${formatLocalDateTime(w.scannedAt, timezone || null)}"`);
      row.push(`"${w.scannedBy?.name || w.scannedBy?.email || ""}"`);
      row.push(`"${w.scannedBy?.staffType || ""}"`);

      lines.push(row.join(","));
    });
  }

  const csv = "\uFEFF" + lines.join("\n");

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${event.slug}_filtered_registrations.csv`
  );
  res.setHeader("Content-Type", "text/csv;charset=utf-8");

  return res.send(csv);
});

// CREATE registration (CMS single create)
exports.createRegistration = asyncHandler(async (req, res) => {
  const { slug } = req.body;
  if (!slug) return response(res, 400, "Event slug is required");

  const event = await Event.findOne({ slug });
  if (!event || !["closed", "employee"].includes(event.eventType)) {
    return response(res, 404, "Event not found");
  }

  if (event.registrations >= event.capacity) {
    return response(res, 400, "Event capacity is full");
  }

  const eventId = event._id;
  const formFields = event.formFields || {};
  let customFields = {};

  // ---------- BUILD CUSTOM FIELDS ----------
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

  // ---------- CANONICAL VALUES ----------
  const fullName =
    formFields.length > 0 ? pickFullName(customFields) : req.body.fullName;

  const email =
    formFields.length > 0 ? pickEmail(customFields) : req.body.email;

  const phoneRaw =
    formFields.length > 0 ? pickPhone(customFields) : req.body.phone;

  const company =
    formFields.length > 0 ? pickCompany(customFields) : req.body.company;

  if (formFields.length === 0) {
    if (!fullName || !email) {
      return response(res, 400, "Full name and email are required");
    }
  }

  const normalizedPhone = normalizePhone(phoneRaw);

  let phoneIsoCode = req.body.isoCode || null;
  let phoneLocalNumber = null;
  let phoneForValidation = null;
  let phoneForDuplicateCheck = null;

  if (normalizedPhone) {
    phoneLocalNumber = normalizedPhone;
    phoneForValidation = normalizedPhone;

    if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode);
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
        phoneLocalNumber = normalizedPhone;
        phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
      }
    } else if (!phoneIsoCode) {
      phoneIsoCode = DEFAULT_ISO_CODE;
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
    } else {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
    }

    const phoneCheck = validatePhoneNumberByCountry(phoneForValidation);
    if (!phoneCheck.valid) {
      return response(res, 400, phoneCheck.error);
    }

    phoneForDuplicateCheck = phoneForValidation;
  }

  if (formFields.length > 0) {
    const phoneField = formFields.find((f) =>
      f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
    );
    if (phoneField && customFields[phoneField.inputName]) {
      customFields[phoneField.inputName] = phoneLocalNumber;
    }
  }

  // ---------- DUPLICATE CHECK ----------
  const duplicateOr = [];

  if (formFields.length > 0) {
    const emailField = formFields.find((f) => f.inputType === "email");
    const phoneField = formFields.find((f) =>
      f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
    );

    if (emailField && email && String(email).trim()) {
      duplicateOr.push({ [`customFields.${emailField.inputName}`]: email });
    }
    if (phoneField && phoneForDuplicateCheck && String(phoneForDuplicateCheck).trim()) {
      duplicateOr.push({ [`customFields.${phoneField.inputName}`]: phoneForDuplicateCheck });
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
    if (email) duplicateOr.push({ email });
    if (phoneForDuplicateCheck) {
      duplicateOr.push({ phone: phoneForDuplicateCheck });
      if (phoneLocalNumber && phoneIsoCode) {
        duplicateOr.push({ $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }] });
      }
    }
  }

  if (duplicateOr.length > 0) {
    const dup = await Registration.findOne({
      eventId,
      $or: duplicateOr,
    });

    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  // ---------- CREATE ----------
  const newRegistration = await Registration.create({
    eventId,
    fullName,
    email,
    phone: formFields.length > 0 ? null : phoneLocalNumber,
    isoCode: formFields.length > 0 ? null : phoneIsoCode,
    company,
    customFields,
    approvalStatus: "pending",
  });

  if (formFields.length > 0 && phoneIsoCode) {
    newRegistration.isoCode = phoneIsoCode;
    await newRegistration.save();
  }

  await recountEventRegistrations(event._id);

  emitNewRegistration(event._id.toString(), {
    _id: newRegistration._id,
    token: newRegistration.token,
    emailSent: newRegistration.emailSent,
    whatsappSent: newRegistration.whatsappSent,
    createdAt: newRegistration.createdAt,
    approvalStatus: newRegistration.approvalStatus,
    fullName,
    email,
    phone: phoneForDuplicateCheck,
    company,
    customFields,
    walkIns: [],
  });

  return response(res, 201, "Registration successful", newRegistration);
});

// UPDATE registration (Admin editable)
exports.updateRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { fields } = req.body;

  const reg = await Registration.findById(id).populate("eventId");
  if (!reg) return response(res, 404, "Registration not found");

  const event = reg.eventId;
  const hasCustomFields = event?.formFields?.length > 0;

  const originalEmail = reg.email;
  const originalPhone = reg.phone ? normalizePhone(reg.phone) : null;

  const newCustomFields = hasCustomFields
    ? { ...Object.fromEntries(reg.customFields || []), ...fields }
    : {};

  // ---------- CANONICAL VALUES ----------
  const email = hasCustomFields
    ? pickEmail(newCustomFields)
    : fields.email ?? fields.Email ?? reg.email;

  const phoneRaw = hasCustomFields
    ? pickPhone(newCustomFields)
    : fields.phone ?? fields.Phone ?? reg.phone;

  let normalizedPhone = phoneRaw ? normalizePhone(phoneRaw) : null;
  let phoneLocalNumber = null;
  let phoneIsoCode = null;
  let phoneForDuplicateCheck = null;

  if (normalizedPhone) {
    phoneIsoCode = fields.isoCode || reg.isoCode || null;
    let phoneForValidation = normalizedPhone;

    if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode);
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
        phoneLocalNumber = normalizedPhone;
        phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
      }
    } else if (!phoneIsoCode) {
      phoneIsoCode = reg.isoCode || DEFAULT_ISO_CODE;
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
    } else {
      phoneLocalNumber = normalizedPhone;
      phoneForValidation = combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
    }

    const phoneCheck = validatePhoneNumberByCountry(phoneForValidation);
    if (!phoneCheck.valid) {
      return response(res, 400, phoneCheck.error);
    }

    phoneForDuplicateCheck = phoneForValidation;
  }

  const emailChanged = email && email !== originalEmail;
  const phoneChanged = phoneForDuplicateCheck && phoneForDuplicateCheck !== originalPhone;

  // ---------- DUPLICATE CHECK ----------
  if (emailChanged || phoneChanged) {
    const duplicateOr = [];
    if (emailChanged) duplicateOr.push({ email });
    if (phoneChanged && phoneForDuplicateCheck) {
      duplicateOr.push({ phone: phoneForDuplicateCheck });
      if (phoneLocalNumber && phoneIsoCode) {
        duplicateOr.push({ $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }] });
      }
    }

    const dup = await Registration.findOne({
      eventId: event._id,
      _id: { $ne: reg._id },
      ...(duplicateOr.length > 0 ? { $or: duplicateOr } : {}),
    });

    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  // ---------- APPLY UPDATE ----------
  if (hasCustomFields) {
    const phoneField = event.formFields.find((f) =>
      f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
    );

    if (phoneField && phoneLocalNumber) {
      newCustomFields[phoneField.inputName] = phoneLocalNumber;
    }

    reg.customFields = newCustomFields;
    reg.fullName = null;
    reg.email = null;
    reg.phone = null;
    reg.company = null;
    if (phoneIsoCode) {
      reg.isoCode = phoneIsoCode;
    }
  } else {
    reg.fullName = fields.fullName ?? fields["Full Name"] ?? reg.fullName;
    reg.email = email;
    if (phoneLocalNumber !== null) {
      reg.phone = phoneLocalNumber;
    }
    if (phoneIsoCode) {
      reg.isoCode = phoneIsoCode;
    }
    reg.company = fields.company ?? fields.Company ?? reg.company;
    reg.customFields = {};
  }

  await reg.save();

  return response(res, 200, "Registration updated successfully", reg);
});

// UPDATE approval status
exports.updateRegistrationApproval = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["confirmed", "pending", "not_attending"].includes(status)) {
    return response(res, 400, "Invalid status");
  }

  const reg = await Registration.findById(id);
  if (!reg) return response(res, 404, "Registration not found");

  reg.approvalStatus = status;

  if (status === "confirmed" && !reg.confirmedAt) {
    reg.confirmedAt = new Date();
  }

  await reg.save();

  return response(res, 200, "Status updated", reg);
});

// VERIFY registration by QR token and create a WalkIn
exports.verifyRegistrationByToken = asyncHandler(async (req, res) => {
  const { token } = req.query;
  const staffUser = req.user;

  if (!token) return response(res, 400, "Token is required");
  if (!staffUser?.id)
    return response(res, 401, "Unauthorized – no scanner info");

  const reg = await Registration.findOne({ token }).populate("eventId");
  if (!reg || reg.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 404, "Registration not found for closed event");
  }

  const walkin = new WalkIn({
    registrationId: reg._id,
    eventId: reg.eventId._id,
    scannedBy: staffUser.id,
  });
  await walkin.save();

  const zpl = buildBadgeZpl({
    fullName:
      pickFullName(reg.customFields) ||
      reg.fullName ||
      `Guest ${reg.token?.slice(-4) || ""}`,
    company: pickCompany(reg.customFields) || reg.company || "",
    eventName: reg.eventId?.name,
    token: reg.token,
    title: pickTitle(reg.customFields),
    badgeId: pickBadgeIdentifier(reg.customFields),
    wing: pickWing(reg.customFields),
  });

  recomputeAndEmit(reg.eventId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Registration verified and walk-in recorded", {
    registrationId: reg._id,
    token: reg.token,
    walkinId: walkin._id,
    scannedAt: walkin.scannedAt,
    scannedBy: {
      name: staffUser.name || staffUser.email,
    },
    zpl,
  });
});

// Create walkin record for a registration (Admin/Business use)
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
      `Only admin or business users can create walk-in records. Your role: ${userDoc.role}`
    );
  }

  const registration = await Registration.findById(id)
    .populate("eventId")
    .notDeleted();

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 400, "This registration is not for a closed event");
  }

  if (registration.eventId?.requiresApproval) {
    if (registration.approvalStatus !== "confirmed") {
      return response(res, 400, "This registration is not attending");
    }
  }

  const walkin = new WalkIn({
    registrationId: registration._id,
    eventId: registration.eventId?._id,
    scannedBy: adminUser.id,
  });
  await walkin.save();

  recomputeAndEmit(registration.eventId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
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

// SOFT DELETE registration
exports.deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  const registration = await Registration.findById(id);
  if (!registration) return response(res, 404, "Registration not found");

  await registration.softDelete(req.user?._id);

  await Event.findByIdAndUpdate(registration.eventId, {
    $inc: { registrations: -1 },
  });

  return response(res, 200, "Registration moved to Recycle Bin");
});

// RESTORE ALL
exports.restoreAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length)
    return response(res, 404, "No registrations found in trash to restore");

  for (const reg of regs) {
    await reg.restore();
    await Event.findByIdAndUpdate(reg.eventId, {
      $inc: { registrations: 1 },
    });
  }

  return response(res, 200, `Restored ${regs.length} registrations`);
});

// PERMANENT DELETE ALL (cascade walk-ins)
exports.permanentDeleteAllRegistrations = asyncHandler(async (req, res) => {
  const regs = await Registration.findDeleted();
  if (!regs.length)
    return response(res, 404, "No registrations found in trash to delete");

  const regIds = regs.map((r) => r._id);

  // Delete walk-ins linked to all trashed registrations
  await WalkIn.deleteMany({ registrationId: { $in: regIds } });

  await Registration.deleteManyDeleted();

  return response(
    res,
    200,
    `Permanently deleted ${regs.length} registrations and their walk-ins`
  );
});

// Get registration by token (public endpoint for confirmation page)
exports.getRegistrationByToken = asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return response(res, 400, "Token is required");
  }

  const registration = await Registration.findOne({ token })
    .populate("eventId")
    .notDeleted();

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 400, "Invalid event type");
  }

  const event = registration.eventId;
  const formFields = event.formFields || [];
  let fullName = null;

  if (formFields.length > 0) {
    const fullNameField = formFields.find(
      (f) =>
        f.inputType === "text" &&
        (f.inputName.toLowerCase().includes("name") ||
          f.inputName.toLowerCase().includes("full"))
    );
    if (fullNameField) {
      fullName = registration.customFields?.get(fullNameField.inputName);
    }
    if (!fullName && registration.customFields) {
      for (const [key, value] of registration.customFields.entries()) {
        if (
          key.toLowerCase().includes("name") ||
          key.toLowerCase().includes("full")
        ) {
          fullName = value;
          break;
        }
      }
    }
  } else {
    fullName = registration.fullName;
  }

  return response(res, 200, "Registration found", {
    registration: {
      _id: registration._id,
      token: registration.token,
      fullName,
      email: registration.email,
      phone: registration.phone,
      isoCode: registration.isoCode,
      company: registration.company,
      customFields: Object.fromEntries(registration.customFields || []),
      approvalStatus: registration.approvalStatus,
      emailSent: registration.emailSent,
      whatsappSent: registration.whatsappSent,
      eventId: registration.eventId._id,
      eventSlug: registration.eventId.slug,
    },
    event: {
      _id: event._id,
      name: event.name,
      slug: event.slug,
      formFields: event.formFields || [],
    },
  });
});

// Confirm presence ( updates approvalStatus to confirmed)
exports.confirmPresence = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return response(res, 400, "Token is required");
  }

  const registration = await Registration.findOne({ token })
    .populate("eventId")
    .notDeleted();

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 400, "Invalid event type");
  }

  registration.approvalStatus = "confirmed";
  if (!registration.confirmedAt) {
    registration.confirmedAt = new Date();
  }
  await registration.save();

  const eventId = registration.eventId?._id || registration.eventId;

  emitPresenceConfirmed(eventId?.toString(), {
    _id: registration._id,
    token: registration.token,
    approvalStatus: registration.approvalStatus,
    fullName: registration.fullName,
    email: registration.email,
    phone: registration.phone,
    company: registration.company,
    customFields: registration.customFields || {},
    createdAt: registration.createdAt,
    confirmedAt: registration.confirmedAt,
  });

  return response(res, 200, "Presence confirmed successfully", {
    registration: {
      _id: registration._id,
      token: registration.token,
      approvalStatus: registration.approvalStatus,
    },
  });
});

// Update attendance status by token
exports.updateAttendanceStatus = asyncHandler(async (req, res) => {
  const { token, status } = req.body;
  if (!token) {
    return response(res, 400, "Token is required");
  }

  if (!["confirmed", "not_attending"].includes(status)) {
    return response(res, 400, "Status must be 'confirmed' or 'not attending'");
  }

  const registration = await Registration.findOne({ token })
    .populate("eventId")
    .notDeleted();

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
    return response(res, 400, "Invalid event type");
  }

  registration.approvalStatus = status;
  if (status === "confirmed" && !registration.confirmedAt) {
    registration.confirmedAt = new Date();
  }
  await registration.save();

  const eventId = registration.eventId?._id || registration.eventId;

  emitPresenceConfirmed(eventId?.toString(), {
    _id: registration._id,
    token: registration.token,
    approvalStatus: registration.approvalStatus,
    fullName: registration.fullName,
    email: registration.email,
    phone: registration.phone,
    company: registration.company,
    customFields: registration.customFields || {},
    createdAt: registration.createdAt,
    confirmedAt: registration.confirmedAt,
  });

  return response(res, 200, "Attendance status updated successfully", {
    registration: {
      _id: registration._id,
      token: registration.token,
      approvalStatus: registration.approvalStatus,
    },
  });
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
      "CheckIn/custom-attachments",
      { inline: true }
    );
    mediaUrl = fileUrl;
    originalFilename = req.file.originalname;
  }

  let filterQuery = {
    eventId: event._id,
    isDeleted: { $ne: true },
  };

  // Apply status filter
  if (statusFilter && statusFilter !== "all") {
    if (statusFilter === "confirmed") {
      filterQuery.approvalStatus = "confirmed";
    } else if (statusFilter === "notConfirmed") {
      filterQuery.approvalStatus = "not_attending";
    } else if (statusFilter === "pending") {
      filterQuery.$and = [
        { approvalStatus: { $exists: true } },
        { approvalStatus: { $ne: "confirmed" } },
        { approvalStatus: { $ne: "not_attending" } },
        { approvalStatus: "pending" },
      ];
    }
  }

  // Apply email sent filter
  if (emailSentFilter && emailSentFilter !== "all") {
    if (emailSentFilter === "sent") {
      filterQuery.emailSent = true;
    } else if (emailSentFilter === "notSent") {
      filterQuery.emailSent = { $ne: true };
    }
  }

  // Apply WhatsApp sent filter
  if (whatsappSentFilter && whatsappSentFilter !== "all") {
    if (whatsappSentFilter === "sent") {
      filterQuery.whatsappSent = true;
    } else if (whatsappSentFilter === "notSent") {
      filterQuery.whatsappSent = { $ne: true };
    }
  }

  const regs = await Registration.find(filterQuery)
    .select(
      "fullName email company customFields token emailSent whatsappSent createdAt approvalStatus"
    )
    .lean();

  response(res, 200, "Bulk notification job started", {
    total: regs.length,
  });

  setImmediate(() => {
    emailProcessor(event, regs, {
      subject,
      body,
      mediaUrl,
      originalFilename,
    }).catch((err) => console.error("CHECKIN EMAIL PROCESSOR FAILED:", err));
  });
});

// Send bulk WhatsApp messages
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

  let mediaUrl = null;
  if (req.file) {
    const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
    const uploadResult = await uploadToCloudinary(
      req.file.buffer,
      req.file.mimetype,
      "Checkin/custom-attachments"
    );
    mediaUrl = uploadResult.secure_url;
  }

  const event = await Event.findOne({ slug }).lean();
  if (!event) return response(res, 404, "Event not found");

  let filterQuery = {
    eventId: event._id,
    isDeleted: { $ne: true },
  };

  // Apply status filter - only if not "all" or undefined
  if (statusFilter && statusFilter !== "all") {
    if (statusFilter === "confirmed") {
      filterQuery.approvalStatus = "confirmed";
    } else if (statusFilter === "notConfirmed") {
      filterQuery.approvalStatus = "not_attending";
    } else if (statusFilter === "pending") {
      filterQuery.$and = [
        { approvalStatus: { $exists: true } },
        { approvalStatus: { $ne: "confirmed" } },
        { approvalStatus: { $ne: "not_attending" } },
        { approvalStatus: "pending" },
      ];
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
      "fullName email phone company customFields token emailSent whatsappSent createdAt approvalStatus isoCode"
    )
    .lean();

  response(res, 200, "Bulk notification job started", {
    total: regs.length,
  });

  setImmediate(() => {
    whatsappProcessor({
      event,
      recipients: regs,
      mode: type === "custom" ? "custom" : "template",
      customMessage: type === "custom" ? { subject, body, mediaUrl } : null,
    }).catch((err) => console.error("CHECKIN WHATSAPP PROCESSOR FAILED:", err));
  });
});
