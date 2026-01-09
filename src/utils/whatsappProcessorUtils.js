const Registration = require("../models/Registration");
const { pickPhone, pickFullName } = require("./customFieldUtils");
const { combinePhoneWithCountryCode } = require("./countryCodes");

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
const formatPhoneForWhatsApp = (phone, isoCode = null) => {
    if (!phone) {
        return { formatted: null, error: "Phone number is required" };
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
        return { formatted: null, error: "Phone number is required" };
    }

    let phoneWithCountryCode = null;

    if (normalizedPhone.startsWith("+")) {
        phoneWithCountryCode = normalizedPhone;
    } else {
        if (!isoCode) {
            return { formatted: null, error: "ISO code is required for phone number without country code" };
        }
        phoneWithCountryCode = combinePhoneWithCountryCode(normalizedPhone, isoCode);
        if (!phoneWithCountryCode) {
            return { formatted: null, error: "Failed to combine phone number with country code" };
        }
    }

    // Validate the final phone number
    const digits = phoneWithCountryCode.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
        return { formatted: null, error: "Invalid phone number length" };
    }

    return {
        formatted: `whatsapp:${phoneWithCountryCode}`,
        error: null,
    };
};

/* ---------- Registration resolver ---------- */
const resolveRecipientContext = async (recipientId, fallback = {}) => {
    const reg = await Registration.findById(recipientId)
        .select("customFields fullName phone email company token eventId isoCode")
        .lean();

    const cf = normalizeCustomFields(reg?.customFields);

    const phone =
        fallback.phone ||
        reg?.phone ||
        pickPhone(cf) ||
        null;

    const isoCode =
        fallback.isoCode ||
        reg?.isoCode ||
        null;

    const fullName =
        fallback.fullName ||
        reg?.fullName ||
        pickFullName(cf) ||
        null;

    return { reg, cf, phone, isoCode, fullName };
};

module.exports = {
    normalizeCustomFields,
    normalizePhone,
    validatePhoneNumber,
    formatPhoneForWhatsApp,
    resolveRecipientContext,
};
