const mongoose = require("mongoose");
const XLSX = require("xlsx");
const asyncHandler = require("../../middlewares/asyncHandler");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const WalkIn = require("../../models/WalkIn");
const User = require("../../models/User");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const recountEventRegistrations = require("../../utils/recountEventRegistrations");
const { emitTaskCompletedUpdate, emitNewRegistration, emitWalkInNew, emitLoadingProgress } = require("../../socket/modules/digipass/digiPassSocket");
const { formatLocalDateTime } = require("../../utils/dateUtils");
const { pickFullName, pickEmail, pickPhone } = require("../../utils/customFieldUtils");
const { normalizePhone } = require("../../utils/whatsappProcessorUtils");
const { validatePhoneNumberByCountry } = require("../../utils/phoneValidation");
const {
    extractCountryCodeAndIsoCode,
    combinePhoneWithCountryCode,
    DEFAULT_ISO_CODE,
} = require("../../utils/countryCodes");
const uploadProcessor = require("../../processors/digipass/uploadProcessor");

const ALLOWED_EVENT_TYPE = "digipass";

// GET all registrations for an event
exports.getRegistrationsByEvent = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    const eventId = event._id;

    await recountEventRegistrations(eventId);

    const totalRegistrations = await Registration.countDocuments({
        eventId,
        isDeleted: { $ne: true },
    });

    const registrations = await Registration.find({ eventId })
        .notDeleted()
        .populate("createdBy", "name")
        .populate("updatedBy", "name")
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
                createdAt: reg.createdAt,
                updatedAt: reg.updatedAt,
                createdBy: reg.createdBy,
                updatedBy: reg.updatedBy,
                isoCode: reg.isoCode,
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
                .where("isDeleted")
                .ne(true)
                .sort({ createdAt: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .populate("createdBy", "name")
                .populate("updatedBy", "name")
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
                        createdAt: reg.createdAt,
                        updatedAt: reg.updatedAt,
                        createdBy: reg.createdBy,
                        updatedBy: reg.updatedBy,
                        isoCode: reg.isoCode,
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

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    const eventId = event._id;
    await recountEventRegistrations(eventId);
    const totalCount = await Registration.countDocuments({
        eventId,
        isDeleted: { $ne: true },
    });

    const registrations = await Registration.find({ eventId })
        .where("isDeleted")
        .ne(true)
        .sort({ createdAt: 1 })
        .limit(50)
        .populate("createdBy", "name")
        .populate("updatedBy", "name")
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
                createdAt: reg.createdAt,
                updatedAt: reg.updatedAt,
                createdBy: reg.createdBy,
                updatedBy: reg.updatedBy,
                isoCode: reg.isoCode,
                customFields: reg.customFields || {},
                walkIns: walkIns.map((w) => ({
                    scannedAt: w.scannedAt,
                    scannedBy: w.scannedBy,
                })),
            };
        })
    );

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

// GET single registration by ID
exports.getRegistrationById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return response(res, 400, "Invalid Registration ID");
    }

    const registration = await Registration.findById(id)
        .populate("eventId")
        .notDeleted();

    if (!registration) {
        return response(res, 404, "Registration not found");
    }

    if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    return response(res, 200, "Registration fetched successfully", registration);
});

// Helper function to check identity field uniqueness
async function checkIdentityUniqueness(event, customFields, excludeRegistrationId = null) {
    if (!event.formFields || event.formFields.length === 0) {
        return { valid: true, error: null };
    }

    const identityFields = event.formFields.filter((f) => f.identity === true);

    if (identityFields.length === 0) {
        return { valid: true, error: null };
    }

    for (const field of identityFields) {
        const fieldValue = customFields.get
            ? customFields.get(field.inputName)
            : customFields[field.inputName];

        if (!fieldValue) {
            continue;
        }

        const query = {
            eventId: event._id,
            [`customFields.${field.inputName}`]: fieldValue,
        };

        if (excludeRegistrationId) {
            query._id = { $ne: excludeRegistrationId };
        }

        const existingReg = await Registration.findOne(query).notDeleted();

        if (existingReg) {
            return {
                valid: false,
                error: "User already exists. Please try to sign in instead.",
            };
        }
    }

    return { valid: true, error: null };
}

// CREATE registration
exports.createRegistration = asyncHandler(async (req, res) => {
    const { slug } = req.body;
    if (!slug) {
        return response(res, 400, "Event slug is required");
    }

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    const formFields = event.formFields || [];
    const hasCustomFields = formFields.length > 0;

    const customFields = {};

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
                    `Invalid value for ${field.inputName}. Allowed: ${field.values.join(", ")}`
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

    const identityCheck = await checkIdentityUniqueness(event, customFields);
    if (!identityCheck.valid) {
        return response(res, 400, identityCheck.error);
    }

    const extractedEmail = hasCustomFields
        ? pickEmail(customFields)
        : req.body.email;

    const extractedPhone = hasCustomFields
        ? pickPhone(customFields)
        : req.body.phone;

    const normalizedPhone = normalizePhone(extractedPhone);

    let phoneIsoCode = req.body.isoCode || null;
    let phoneLocalNumber = null;
    let phoneForValidation = null;
    let phoneForDuplicateCheck = null;

    if (normalizedPhone) {
        phoneLocalNumber = normalizedPhone;
        phoneForValidation = normalizedPhone;

        if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
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
                phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
            }
        } else if (!phoneIsoCode) {
            phoneIsoCode = DEFAULT_ISO_CODE;
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

    let phoneField = null;
    if (hasCustomFields) {
        phoneField = formFields.find((f) =>
            f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
        );
        if (phoneField && customFields[phoneField.inputName]) {
            customFields[phoneField.inputName] = phoneLocalNumber;
        }
    }

    const duplicateOr = [];

    if (hasCustomFields) {
        const emailField = formFields.find((f) => f.inputType === "email");

        if (emailField && extractedEmail && String(extractedEmail).trim()) {
            duplicateOr.push({ [`customFields.${emailField.inputName}`]: extractedEmail });
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
        if (extractedEmail && String(extractedEmail).trim()) duplicateOr.push({ email: extractedEmail });
        if (phoneForDuplicateCheck && String(phoneForDuplicateCheck).trim()) {
            duplicateOr.push({ phone: phoneForDuplicateCheck });
            if (phoneLocalNumber && phoneIsoCode) {
                duplicateOr.push({ $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }] });
            }
        }
    }

    if (duplicateOr.length > 0) {
        const duplicateFilter = {
            eventId: event._id,
            $or: duplicateOr,
        };

        const dup = await Registration.findOne(duplicateFilter);
        if (dup) {
            return response(res, 409, "Already registered with this email or phone");
        }
    }

    const regPayload = {
        eventId: event._id,
        customFields,
        tasksCompleted: 0,
        isoCode: hasCustomFields ? null : phoneIsoCode,
    };
    const registration = req.user
        ? await Registration.createWithAuditUser(regPayload, req.user)
        : await Registration.create(regPayload);

    if (hasCustomFields && phoneIsoCode) {
        registration.isoCode = phoneIsoCode;
        await registration.save();
    }

    await recountEventRegistrations(event._id);

    recomputeAndEmit(event.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    const populated = await Registration.findById(registration._id)
        .populate("createdBy", "name")
        .populate("updatedBy", "name");
    const regForResponse = populated || registration;

    const enhancedRegistration = {
        _id: regForResponse._id,
        token: regForResponse.token,
        createdAt: regForResponse.createdAt,
        updatedAt: regForResponse.updatedAt,
        createdBy: regForResponse.createdBy,
        updatedBy: regForResponse.updatedBy,
        customFields: regForResponse.customFields || {},
        isoCode: regForResponse.isoCode || null,
        tasksCompleted: regForResponse.tasksCompleted || 0,
        walkIns: [],
    };

    emitNewRegistration(event._id.toString(), enhancedRegistration);

    return response(res, 201, "Registration created successfully", regForResponse);
});

// UPDATE registration
exports.updateRegistration = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { fields } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return response(res, 400, "Invalid Registration ID");
    }

    const registration = await Registration.findById(id)
        .populate("eventId")
        .notDeleted();

    if (!registration) {
        return response(res, 404, "Registration not found");
    }

    if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    const event = registration.eventId;
    const formFields = event.formFields || [];
    const hasCustomFields = formFields.length > 0;

    const originalEmail = pickEmail(registration.customFields) || registration.email;
    const originalPhone = pickPhone(registration.customFields) || registration.phone;

    if (hasCustomFields) {
        const phoneField = event.formFields.find((f) =>
            f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
        );

        const updatedCustomFields = {
            ...Object.fromEntries(registration.customFields || []),
            ...fields,
        };

        for (const field of formFields) {
            if (fields && fields.hasOwnProperty(field.inputName)) {
                let value = fields[field.inputName];

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
                        `Invalid value for ${field.inputName}. Allowed: ${field.values.join(", ")}`
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
                } else {
                    delete updatedCustomFields[field.inputName];
                }
            }
        }

        registration.customFields = updatedCustomFields;
        registration.fullName = null;
        registration.email = null;
        registration.phone = null;
        registration.company = null;
    } else {
        registration.fullName = fields.fullName ?? fields["Full Name"] ?? registration.fullName;
        registration.email = fields.email ?? fields.Email ?? registration.email;
        const phoneRaw = fields.phone ?? fields.Phone;
        if (phoneRaw !== undefined) {
            registration.phone = phoneRaw;
        }
        registration.company = fields.company ?? fields.Company ?? registration.company;
        registration.customFields = {};
    }

    const extractedEmail = hasCustomFields
        ? pickEmail(registration.customFields)
        : registration.email;

    const extractedPhone = hasCustomFields
        ? pickPhone(registration.customFields)
        : registration.phone;

    let normalizedPhone = null;
    let phoneLocalNumber = null;
    let phoneIsoCode = null;
    let phoneForDuplicateCheck = null;

    if (extractedPhone) {
        normalizedPhone = normalizePhone(extractedPhone);

        phoneIsoCode = fields.isoCode || registration.isoCode || null;
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
                phoneForValidation = combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
            }
        } else if (!phoneIsoCode) {
            phoneIsoCode = registration.isoCode || DEFAULT_ISO_CODE;
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

        if (!hasCustomFields) {
            if (phoneLocalNumber !== null) {
                registration.phone = phoneLocalNumber;
            }
            if (phoneIsoCode) {
                registration.isoCode = phoneIsoCode;
            }
        } else {
            const phoneField = event.formFields.find((f) =>
                f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
            );
            if (phoneField && phoneLocalNumber !== null) {
                const updatedCustomFields = {
                    ...Object.fromEntries(registration.customFields || []),
                    [phoneField.inputName]: phoneLocalNumber,
                };
                registration.customFields = updatedCustomFields;
            }
            if (phoneIsoCode) {
                registration.isoCode = phoneIsoCode;
            }
        }
    } else {
        if (!hasCustomFields && fields.isoCode) {
            registration.isoCode = fields.isoCode;
        }
    }

    const emailChanged = extractedEmail && extractedEmail !== originalEmail;
    const phoneChanged = phoneForDuplicateCheck && phoneForDuplicateCheck !== originalPhone;

    if (emailChanged || phoneChanged) {
        const duplicateOr = [];

        if (hasCustomFields) {
            const emailField = event.formFields.find((f) => f.inputType === "email");
            const phoneField = event.formFields.find((f) =>
                f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
            );

            if (emailField && extractedEmail) {
                duplicateOr.push({ [`customFields.${emailField.inputName}`]: extractedEmail });
            }
            if (phoneField && phoneForDuplicateCheck) {
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
            if (extractedEmail) duplicateOr.push({ email: extractedEmail });
            if (phoneForDuplicateCheck) {
                duplicateOr.push({ phone: phoneForDuplicateCheck });
                if (phoneLocalNumber && phoneIsoCode) {
                    duplicateOr.push({ $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }] });
                }
            }
        } else {
            if (extractedEmail) duplicateOr.push({ email: extractedEmail });
            if (phoneForDuplicateCheck) {
                duplicateOr.push({ phone: phoneForDuplicateCheck });
                if (phoneLocalNumber && phoneIsoCode) {
                    duplicateOr.push({ $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }] });
                }
            }
        }

        const duplicateFilter = {
            eventId: event._id,
            _id: { $ne: registration._id },
            ...(duplicateOr.length > 0 ? { $or: duplicateOr } : {}),
        };

        const dup = await Registration.findOne(duplicateFilter);
        if (dup) {
            return response(res, 409, "Already registered with this email or phone");
        }
    }

    if (req.body.tasksCompleted !== undefined) {
        const tasksCompleted = parseInt(req.body.tasksCompleted);
        if (isNaN(tasksCompleted) || tasksCompleted < 0) {
            return response(
                res,
                400,
                "tasksCompleted must be a non-negative number"
            );
        }
        registration.tasksCompleted = tasksCompleted;
    }

    registration.setAuditUser(req.user);
    await registration.save();

    const populated = await Registration.findById(registration._id)
        .populate("createdBy", "name")
        .populate("updatedBy", "name");

    recomputeAndEmit(event.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "Registration updated successfully", populated || registration);
});

// DELETE registration
exports.deleteRegistration = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return response(res, 400, "Invalid Registration ID");
    }

    const registration = await Registration.findById(id)
        .populate("eventId")
        .notDeleted();

    if (!registration) {
        return response(res, 404, "Registration not found");
    }

    if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    await registration.softDelete(req.user?.id || req.user?._id);

    await recountEventRegistrations(registration.eventId._id);

    recomputeAndEmit(registration.eventId.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "Registration moved to recycle bin");
});

// Restore single registration
exports.restoreRegistration = asyncHandler(async (req, res) => {
    const reg = await Registration.findOneDeleted({ _id: req.params.id })
        .populate("eventId");
    if (!reg) {
        return response(res, 404, "Registration not found in trash");
    }

    if (reg.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    const event = reg.eventId;
    await reg.restore();
    await recountEventRegistrations(event._id);

    recomputeAndEmit(event.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "Registration restored successfully", reg);
});

// Restore ALL registrations
exports.restoreAllRegistrations = asyncHandler(async (req, res) => {
    const regs = await Registration.findDeleted()
        .populate("eventId");

    const digiPassRegs = regs.filter((reg) => reg.eventId?.eventType === ALLOWED_EVENT_TYPE);

    if (!digiPassRegs.length) {
        return response(res, 404, "No DigiPass registrations found in trash to restore");
    }

    for (const reg of digiPassRegs) {
        await reg.restore();
        await recountEventRegistrations(reg.eventId._id);
    }

    recomputeAndEmit(null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, `Restored ${digiPassRegs.length} DigiPass registrations`);
});

// Permanent delete single registration
exports.permanentDeleteRegistration = asyncHandler(async (req, res) => {
    const reg = await Registration.findOneDeleted({
        _id: req.params.id,
    })
        .populate("eventId", "businessId");

    if (!reg) {
        return response(res, 404, "Registration not found in trash");
    }

    if (reg.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    const businessId = reg.eventId?.businessId || null;
    const eventId = reg.eventId._id;

    await WalkIn.deleteMany({ registrationId: reg._id });
    await reg.deleteOne();
    await recountEventRegistrations(eventId);

    recomputeAndEmit(businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "Registration permanently deleted");
});

// PERMANENT DELETE ALL digipass registrations (cascade walk-ins)
exports.permanentDeleteAllRegistrations = asyncHandler(async (req, res) => {
    const regs = await Registration.findDeleted()
        .populate("eventId");

    const digiPassRegs = regs.filter((reg) => reg.eventId?.eventType === ALLOWED_EVENT_TYPE);

    if (!digiPassRegs.length) {
        return response(res, 404, "No DigiPass registrations found in trash to delete");
    }

    const regIds = digiPassRegs.map((r) => r._id);

    await WalkIn.deleteMany({ registrationId: { $in: regIds } });
    const result = await Registration.deleteMany({
        _id: { $in: regIds },
    });

    for (const reg of digiPassRegs) {
        await recountEventRegistrations(reg.eventId._id);
    }

    recomputeAndEmit(null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(
        res,
        200,
        `Permanently deleted ${result.deletedCount} DigiPass registrations and their walk-ins`
    );
});

// VERIFY registration by QR token and create a WalkIn (with duplicate check)
exports.verifyRegistrationByToken = asyncHandler(async (req, res) => {
    const { token } = req.query;
    const staffUser = req.user;

    if (!token) {
        return response(res, 400, "Token is required");
    }
    if (!staffUser?.id) {
        return response(res, 401, "Unauthorized – no scanner info");
    }

    const registration = await Registration.findOne({ token })
        .populate("eventId")
        .notDeleted();

    if (!registration) {
        return response(res, 404, "Registration not found");
    }

    if (registration.eventId?.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    const eventBusinessId = registration.eventId?.businessId?.toString();
    const staffBusinessId = staffUser.business?.toString();

    if (!staffBusinessId || staffBusinessId !== eventBusinessId) {
        return response(
            res,
            403,
            "You are not authorized to scan registrations for this business"
        );
    }

    const registrationId = registration._id;
    const eventId = registration.eventId._id;
    const scannedBy = staffUser.id;

    const existingWalkIn = await WalkIn.findOne({
        registrationId,
        eventId,
        scannedBy,
    }).notDeleted();

    if (existingWalkIn) {
        return response(res, 200, "Registration already scanned by this scanner", {
            alreadyScanned: true,
            walkinId: existingWalkIn._id,
            scannedAt: existingWalkIn.scannedAt,
            tasksCompleted: registration.tasksCompleted,
        });
    }

    const maxTasksLimit = registration.eventId?.maxTasksPerUser;
    if (maxTasksLimit !== null && maxTasksLimit !== undefined) {
        const currentTasks = registration.tasksCompleted || 0;
        if (currentTasks >= maxTasksLimit) {
            return response(
                res,
                400,
                `User has already completed the maximum ${maxTasksLimit} task${maxTasksLimit > 1 ? "s" : ""} for this event`
            );
        }
    }

    const walkin = new WalkIn({
        registrationId,
        eventId,
        scannedBy,
    });
    walkin.setAuditUser(req.user);
    await walkin.save();

    registration.tasksCompleted = (registration.tasksCompleted || 0) + 1;
    registration.setAuditUser(req.user);
    await registration.save();

    const eventIdStr = eventId.toString();
    const registrationIdStr = registration._id.toString();
    const maxTasksForEmit = registration.eventId?.maxTasksPerUser || null;

    emitTaskCompletedUpdate(
        eventIdStr,
        registrationIdStr,
        registration.tasksCompleted,
        maxTasksForEmit
    );

    const populatedWalkIn = await WalkIn.findById(walkin._id)
        .populate("scannedBy", "name email staffType")
        .lean();

    const walkInData = {
        _id: populatedWalkIn._id,
        scannedAt: populatedWalkIn.scannedAt,
        scannedBy: {
            _id: populatedWalkIn.scannedBy._id,
            name: populatedWalkIn.scannedBy.name || null,
            email: populatedWalkIn.scannedBy.email || null,
            staffType: populatedWalkIn.scannedBy.staffType || null,
        },
    };

    emitWalkInNew(eventIdStr, registrationIdStr, walkInData);

    recomputeAndEmit(eventBusinessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "Registration verified and task count incremented", {
        registrationId: registration._id,
        token: registration.token,
        walkinId: walkin._id,
        scannedAt: walkin.scannedAt,
        scannedBy: {
            name: staffUser.name || staffUser.email,
            id: staffUser.id,
        },
        tasksCompleted: registration.tasksCompleted,
    });
});

// Sign in using identity fields
exports.signIn = asyncHandler(async (req, res) => {
    const { slug } = req.body;
    if (!slug) {
        return response(res, 400, "Event slug is required");
    }

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    const formFields = event.formFields || [];
    const identityFields = formFields.filter((f) => f.identity === true);

    if (identityFields.length === 0) {
        return response(res, 400, "No identity fields configured for this event");
    }

    const identityValues = {};
    const missingFields = [];

    for (const field of identityFields) {
        const value = req.body[field.inputName];
        if (!value || String(value).trim() === "") {
            missingFields.push(field.inputName);
        } else {
            identityValues[field.inputName] = String(value).trim();
        }
    }

    if (missingFields.length > 0) {
        return response(
            res,
            400,
            `Missing required identity fields: ${missingFields.join(", ")}`
        );
    }

    const query = {
        eventId: event._id,
    };

    const $and = [];
    for (const field of identityFields) {
        const value = identityValues[field.inputName];
        if (value) {
            $and.push({ [`customFields.${field.inputName}`]: value });
        }
    }

    if ($and.length > 0) {
        query.$and = $and;
    }

    const registration = await Registration.findOne(query).notDeleted();

    if (!registration) {
        return response(res, 404, "No registration found with the provided identity information");
    }

    return response(res, 200, "Sign in successful", {
        registration: {
            _id: registration._id,
            token: registration.token,
            tasksCompleted: registration.tasksCompleted,
            customFields: registration.customFields,
            createdAt: registration.createdAt,
        },
        event: {
            _id: event._id,
            name: event.name,
            maxTasksPerUser: event.maxTasksPerUser,
        },
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
        return response(res, 400, "This registration is not for a DigiPass event");
    }

    const registrationId = registration._id;
    const eventId = registration.eventId._id;
    const scannedBy = adminUser.id;

    const existingWalkIn = await WalkIn.findOne({
        registrationId,
        eventId,
        scannedBy,
    }).notDeleted();

    if (existingWalkIn) {
        return response(res, 200, "Walk-in already exists for this scanner", {
            alreadyExists: true,
            walkinId: existingWalkIn._id,
            scannedAt: existingWalkIn.scannedAt,
            tasksCompleted: registration.tasksCompleted,
        });
    }

    const maxTasksLimit = registration.eventId?.maxTasksPerUser;
    if (maxTasksLimit !== null && maxTasksLimit !== undefined) {
        const currentTasks = registration.tasksCompleted || 0;
        if (currentTasks >= maxTasksLimit) {
            return response(
                res,
                400,
                `User has already completed the maximum ${maxTasksLimit} task${maxTasksLimit > 1 ? "s" : ""} for this event`
            );
        }
    }

    const walkin = new WalkIn({
        registrationId,
        eventId,
        scannedBy,
    });
    walkin.setAuditUser(req.user);
    await walkin.save();

    registration.tasksCompleted = (registration.tasksCompleted || 0) + 1;
    registration.setAuditUser(req.user);
    await registration.save();

    const eventIdStr = eventId.toString();
    const registrationIdStr = registration._id.toString();
    const maxTasksForEmit = registration.eventId?.maxTasksPerUser || null;

    emitTaskCompletedUpdate(
        eventIdStr,
        registrationIdStr,
        registration.tasksCompleted,
        maxTasksForEmit
    );

    const populatedWalkIn = await WalkIn.findById(walkin._id)
        .populate("scannedBy", "name email staffType")
        .lean();

    const walkInData = {
        _id: populatedWalkIn._id,
        scannedAt: populatedWalkIn.scannedAt,
        scannedBy: {
            _id: populatedWalkIn.scannedBy._id,
            name: populatedWalkIn.scannedBy.name || null,
            email: populatedWalkIn.scannedBy.email || null,
            staffType: populatedWalkIn.scannedBy.staffType || null,
        },
    };

    emitWalkInNew(eventIdStr, registrationIdStr, walkInData);

    recomputeAndEmit(registration.eventId.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "Walk-in record created and task count incremented", {
        walkinId: walkin._id,
        scannedAt: walkin.scannedAt,
        scannedBy: {
            name: adminUser.name || adminUser.email,
            id: adminUser.id,
        },
        tasksCompleted: registration.tasksCompleted,
    });
});

function validateUploadedFileFields(event, rows) {
    if (!rows || rows.length === 0) {
        return { valid: false, error: "Uploaded file is empty" };
    }

    const firstRow = rows[0];
    const uploadedFields = Object.keys(firstRow).filter((key) => key !== "Token");

    const formFields = event.formFields || [];
    const requiredFields = formFields
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
}

async function validateAllRows(event, rows) {
    const invalidRowNumbers = [];
    const invalidEmailRowNumbers = [];
    const duplicateEmailRowNumbers = [];
    const invalidPhoneRowNumbers = [];
    const duplicateIdentityRowNumbers = [];

    const formFields = event.formFields || [];
    const allRequiredFields = formFields.filter((f) => f.required).map((f) => f.inputName);

    const emailOccurrences = {};
    const phoneOccurrences = {};
    const identityOccurrences = {};

    const identityFields = formFields.filter((f) => f.identity === true);

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        let hasMissingFields = false;
        let hasInvalidEmail = false;

        const extractedEmail = pickEmail(row);
        const extractedPhone = pickPhone(row);

        for (const field of formFields) {
            const value = row[field.inputName];
            if (field.required && (!value || String(value).trim() === "")) {
                hasMissingFields = true;
                break;
            }
        }

        if (extractedEmail && !isValidEmail(extractedEmail)) {
            hasInvalidEmail = true;
        }

        if (extractedEmail) {
            const emailKey = extractedEmail.toLowerCase().trim();
            if (!emailOccurrences[emailKey]) emailOccurrences[emailKey] = [];
            emailOccurrences[emailKey].push(rowNumber);
        }

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

        if (identityFields.length > 0) {
            for (const identityField of identityFields) {
                const value = row[identityField.inputName];
                if (value) {
                    const key = `${identityField.inputName}:${String(value).trim()}`;
                    if (!identityOccurrences[key]) identityOccurrences[key] = [];
                    identityOccurrences[key].push(rowNumber);
                }
            }
        }

        if (hasMissingFields) invalidRowNumbers.push(rowNumber);
        if (hasInvalidEmail) invalidEmailRowNumbers.push(rowNumber);
    });

    for (const email in emailOccurrences) {
        if (emailOccurrences[email].length > 1) {
            duplicateEmailRowNumbers.push(...emailOccurrences[email]);
        }
    }

    for (const key in identityOccurrences) {
        if (identityOccurrences[key].length > 1) {
            duplicateIdentityRowNumbers.push(...identityOccurrences[key]);
        }
    }

    if (invalidRowNumbers.length > 0) {
        return {
            valid: false,
            error: `Cannot upload file. Row${invalidRowNumbers.length > 1 ? "s" : ""
                } ${formatRowNumbers(invalidRowNumbers)} ${invalidRowNumbers.length > 1 ? "have" : "has"
                } missing required fields: ${allRequiredFields.join(", ")}.`,
        };
    }

    if (invalidEmailRowNumbers.length > 0) {
        return {
            valid: false,
            error: `Cannot upload file. Row${invalidEmailRowNumbers.length > 1 ? "s" : ""
                } ${formatRowNumbers(invalidEmailRowNumbers)} ${invalidEmailRowNumbers.length > 1 ? "have" : "has"
                } invalid email format.`,
        };
    }

    if (duplicateEmailRowNumbers.length > 0) {
        return {
            valid: false,
            error: `Cannot upload file. Duplicate email(s) found at row${duplicateEmailRowNumbers.length > 1 ? "s" : ""
                } ${formatRowNumbers(duplicateEmailRowNumbers)}. Each email must be unique.`,
        };
    }

    if (duplicateIdentityRowNumbers.length > 0) {
        return {
            valid: false,
            error: `Cannot upload file. Duplicate identity field value(s) found at row${duplicateIdentityRowNumbers.length > 1 ? "s" : ""
                } ${formatRowNumbers(duplicateIdentityRowNumbers)}. Identity fields must be unique.`,
        };
    }

    const emailsInFile = Object.keys(emailOccurrences);
    const phonesInFile = Object.keys(phoneOccurrences);

    if (emailsInFile.length || phonesInFile.length) {
        const duplicateOr = [];

        const emailField = formFields.find((f) => f.inputType === "email");
        const phoneField = formFields.find((f) =>
            f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
        );

        if (emailField && emailsInFile.length) {
            emailsInFile.forEach((email) => {
                duplicateOr.push({ [`customFields.${emailField.inputName}`]: email });
            });
        }
        if (phoneField && phonesInFile.length) {
            phonesInFile.forEach((phone) => {
                duplicateOr.push({ [`customFields.${phoneField.inputName}`]: phone });
            });
        }

        if (duplicateOr.length > 0) {
            const existing = await Registration.find({
                eventId: event._id,
                $or: duplicateOr,
            }).select("customFields").notDeleted();

            if (existing.length > 0) {
                const conflictRows = new Set();

                existing.forEach((reg) => {
                    if (emailField) {
                        const regEmail = pickEmail(reg.customFields);
                        if (regEmail && emailOccurrences[regEmail.toLowerCase()]) {
                            emailOccurrences[regEmail.toLowerCase()].forEach((r) =>
                                conflictRows.add(r)
                            );
                        }
                    }
                    if (phoneField) {
                        const regPhone = pickPhone(reg.customFields);
                        if (regPhone) {
                            const normalizedRegPhone = normalizePhone(regPhone);
                            if (phoneOccurrences[normalizedRegPhone]) {
                                phoneOccurrences[normalizedRegPhone].forEach((r) =>
                                    conflictRows.add(r)
                                );
                            }
                        }
                    }
                });

                if (conflictRows.size > 0) {
                    return {
                        valid: false,
                        error: `Some rows are already registered for this event: rows ${formatRowNumbers(
                            [...conflictRows]
                        )}`,
                    };
                }
            }
        }
    }

    if (identityFields.length > 0) {
        for (const identityField of identityFields) {
            const identityValues = [];
            rows.forEach((row) => {
                const value = row[identityField.inputName];
                if (value) {
                    identityValues.push(String(value).trim());
                }
            });

            if (identityValues.length > 0) {
                const existing = await Registration.find({
                    eventId: event._id,
                    [`customFields.${identityField.inputName}`]: { $in: identityValues },
                }).select(`customFields.${identityField.inputName}`).notDeleted();

                if (existing.length > 0) {
                    const conflictRows = new Set();
                    const existingValues = new Set(
                        existing.map((reg) => {
                            const val = reg.customFields?.get
                                ? reg.customFields.get(identityField.inputName)
                                : reg.customFields?.[identityField.inputName];
                            return val ? String(val).trim() : null;
                        }).filter(Boolean)
                    );

                    rows.forEach((row, index) => {
                        const value = row[identityField.inputName];
                        if (value && existingValues.has(String(value).trim())) {
                            conflictRows.add(index + 2);
                        }
                    });

                    if (conflictRows.size > 0) {
                        return {
                            valid: false,
                            error: `Cannot upload file. Identity field "${identityField.inputName}" value(s) already exist in database at row${conflictRows.size > 1 ? "s" : ""
                                } ${formatRowNumbers([...conflictRows])}. Identity fields must be unique.`,
                        };
                    }
                }
            }
        }
    }

    return {
        valid: true,
        warning:
            invalidPhoneRowNumbers.length > 0
                ? `Some rows have invalid phone numbers and may not receive WhatsApp messages: rows ${formatRowNumbers(
                    invalidPhoneRowNumbers
                )}`
                : null,
    };
}

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

exports.downloadSampleExcel = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    const hasCustomFields = event.formFields && event.formFields.length > 0;
    const formFields = event.formFields || [];

    let headers = [];
    const phoneFields = [];

    if (hasCustomFields) {
        formFields.forEach((f) => {
            headers.push(f.inputName);
            if (f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")) {
                phoneFields.push({ name: f.inputName, index: headers.length - 1 });
            }
        });
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
        }
        row.push("");
        rows.push(row);
    });

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

exports.uploadRegistrations = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    if (!slug) return response(res, 400, "Event Slug is required");

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) return response(res, 404, "DigiPass event not found");

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

    const rowValidation = await validateAllRows(event, rows);
    if (!rowValidation.valid) {
        return response(res, 400, rowValidation.error);
    }

    response(res, 200, "Upload started", {
        total: rows.length,
    });

    setImmediate(() => {
        uploadProcessor(event, rows, req.user).catch((err) =>
            console.error("UPLOAD PROCESSOR FAILED:", err)
        );
    });
});

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
        timezone,
        ...dynamicFiltersRaw
    } = req.query;

    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE }).notDeleted();
    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    const eventId = event._id;
    const hasCustomFields = event.formFields && event.formFields.length > 0;

    const mongoQuery = {
        eventId,
        isDeleted: { $ne: true },
    };

    if (token) mongoQuery.token = new RegExp(token, "i");

    const dynamicFilters = Object.entries(dynamicFiltersRaw)
        .filter(([key]) => key.startsWith("field_"))
        .reduce((acc, [key, val]) => {
            const fieldName = key.replace("field_", "");

            if (hasCustomFields) {
                acc[`customFields.${fieldName}`] = new RegExp(val, "i");
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
        : [];

    const lines = [];

    const business = await Business.findById(event.businessId).lean();

    const exportedAt = formatLocalDateTime(Date.now(), timezone || null);

    const activeFilters = [];

    if (search) activeFilters.push(`Search: "${search}"`);
    if (token) activeFilters.push(`Token: "${token}"`);
    if (createdFrom || createdTo) {
        const fromStr = createdFrom ? formatLocalDateTime(Number(createdFrom), timezone || null) : "—";
        const toStr = createdTo ? formatLocalDateTime(Number(createdTo), timezone || null) : "—";
        activeFilters.push(`Registered At: ${fromStr} to ${toStr}`);
    }
    if (scannedFrom || scannedTo) {
        const fromStr = scannedFrom ? formatLocalDateTime(Number(scannedFrom), timezone || null) : "—";
        const toStr = scannedTo ? formatLocalDateTime(Number(scannedTo), timezone || null) : "—";
        activeFilters.push(`Scanned At: ${fromStr} to ${toStr}`);
    }
    if (scannedBy) activeFilters.push(`Scanned By: "${scannedBy}"`);

    Object.entries(dynamicFiltersRaw)
        .filter(([key]) => key.startsWith("field_"))
        .forEach(([key, val]) => {
            const fieldName = key.replace("field_", "");
            activeFilters.push(`${fieldName}: "${val}"`);
        });

    const filtersString = activeFilters.length > 0 ? activeFilters.join("; ") : "None";

    lines.push(`Event Name,${event.name || "N/A"}`);
    lines.push(`Business Name,${business?.name || "N/A"}`);
    lines.push(`Logo URL,${event.logoUrl || "N/A"}`);
    lines.push(`Event Slug,${event.slug || "N/A"}`);
    lines.push(`Min Tasks Per User,${event.minTasksPerUser ?? "N/A"}`);
    lines.push(`Max Tasks Per User,${event.maxTasksPerUser ?? "N/A"}`);
    lines.push(`Total Registrations,${event.registrations || 0}`);
    lines.push(`Exported Registrations,${regs.length}`);
    lines.push(`Exported At,"${exportedAt}"`);
    lines.push(`Applied Filters,"${filtersString}"`);
    lines.push("");

    lines.push("=== Registrations ===");

    const regHeaders = [...dynamicFields, "Token", "Registered At", "Completed Activities"];
    lines.push(regHeaders.join(","));

    regs.forEach((reg) => {
        const row = dynamicFields.map(
            (f) =>
                `"${((reg.customFields?.[f] ?? "") + "").replace(
                    /"/g,
                    '""'
                )}"`
        );

        row.push(`"${reg.token}"`);
        row.push(`"${formatLocalDateTime(reg.createdAt, timezone || null)}"`);
        row.push(`"${reg.tasksCompleted || 0}"`);

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
            "Registered At",
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
                    `"${((reg?.customFields?.[f] ?? "") + "").replace(
                        /"/g,
                        '""'
                    )}"`
            );

            row.push(`"${reg.token}"`);
            row.push(`"${formatLocalDateTime(reg.createdAt, timezone || null)}"`);
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

