const Registration = require("../models/Registration");
const { pickPhone, pickFullName } = require("./customFieldUtils");

/* ---------- Custom fields normalization ---------- */
const normalizeCustomFields = (customFields) => {
    if (!customFields) return {};
    if (Array.isArray(customFields)) return Object.fromEntries(customFields);
    if (typeof customFields === "object") return customFields;
    return {};
};

/* ---------- Phone validation ---------- */
const validatePhoneNumber = (phone) => {
    if (!phone) return { valid: false, error: "Phone number is required" };

    const phoneStr = String(phone).trim();
    if (!phoneStr.startsWith("+")) {
        return { valid: false, error: "Phone must start with country code" };
    }

    const digits = phoneStr.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
        return { valid: false, error: "Invalid phone number length" };
    }

    return { valid: true };
};

/* ---------- WhatsApp formatting ---------- */
const formatPhoneForWhatsApp = (phone) => {
    const validation = validatePhoneNumber(phone);
    if (!validation.valid) {
        return { formatted: null, error: validation.error };
    }
    return { formatted: `whatsapp:${phone}`, error: null };
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
    formatPhoneForWhatsApp,
    resolveRecipientContext,
};
