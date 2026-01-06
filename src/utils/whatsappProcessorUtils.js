const Registration = require("../models/Registration");
const { pickPhone, pickFullName } = require("./customFieldUtils");

/* ---------- Custom fields normalization ---------- */
const normalizeCustomFields = (customFields) => {
    if (!customFields) return {};
    if (Array.isArray(customFields)) return Object.fromEntries(customFields);
    if (typeof customFields === "object") return customFields;
    return {};
};

/* ---------- Phone normalization ---------- */
const normalizePhone = (phone) => {
    if (!phone) return null;

    return String(phone)
        .trim()
        .replace(/\s+/g, "")      // remove ALL spaces
        .replace(/[()-]/g, "");  // remove (), -
};

/* ---------- Phone validation ---------- */
const validatePhoneNumber = (phone) => {
    const phoneStr = normalizePhone(phone);
    if (!phoneStr) {
        return { valid: false, error: "Phone number is required" };
    }

    if (!phoneStr.startsWith("+")) {
        return { valid: false, error: "Phone must start with country code" };
    }

    const digits = phoneStr.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
        return { valid: false, error: "Invalid phone number length" };
    }

    return { valid: true, normalized: phoneStr };
};

/* ---------- WhatsApp formatting ---------- */
const formatPhoneForWhatsApp = (phone) => {
    const validation = validatePhoneNumber(phone);
    if (!validation.valid) {
        return { formatted: null, error: validation.error };
    }

    return {
        formatted: `whatsapp:${validation.normalized}`,
        error: null,
    };
};

/* ---------- Registration resolver ---------- */
const resolveRecipientContext = async (recipientId, fallback = {}) => {
    const reg = await Registration.findById(recipientId)
        .select("customFields fullName phone email company token eventId")
        .lean();

    const cf = normalizeCustomFields(reg?.customFields);

    const phone =
        fallback.phone ||
        reg?.phone ||
        pickPhone(cf) ||
        null;

    const fullName =
        fallback.fullName ||
        reg?.fullName ||
        pickFullName(cf) ||
        null;

    return { reg, cf, phone, fullName };
};

module.exports = {
    normalizeCustomFields,
    normalizePhone,
    validatePhoneNumber,
    formatPhoneForWhatsApp,
    resolveRecipientContext,
};
