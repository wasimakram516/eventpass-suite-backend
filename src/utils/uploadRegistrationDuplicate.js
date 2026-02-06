const Registration = require("../models/Registration");
const { pickEmail, pickPhone } = require("./customFieldUtils");
const { normalizePhone } = require("./whatsappProcessorUtils");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
} = require("./countryCodes");

function normalizeCustomFieldsSafe(customFields) {
  if (!customFields) return {};
  if (customFields instanceof Map) return Object.fromEntries(customFields);
  if (Array.isArray(customFields)) return Object.fromEntries(customFields);
  if (typeof customFields === "object") return customFields;
  return {};
}

function buildPhoneKeys(phone, isoCode) {
  const keys = new Set();
  const normalized = normalizePhone(phone);
  if (!normalized) return keys;

  let phoneLocal = normalized;
  let phoneWithCode = null;

  if (normalized.startsWith("+")) {
    phoneWithCode = normalized;
    const extracted = extractCountryCodeAndIsoCode(normalized);
    if (extracted.localNumber) {
      phoneLocal = extracted.localNumber;
    }
  } else if (isoCode) {
    phoneWithCode = combinePhoneWithCountryCode(normalized, isoCode) || null;
  }

  if (phoneLocal) keys.add(String(phoneLocal));
  if (phoneWithCode) keys.add(String(phoneWithCode));
  return keys;
}

function createDuplicateIndex() {
  return {
    emailSet: new Set(),
    phoneSet: new Set(),
  };
}

function addToDuplicateIndex(index, { email, phone, isoCode }) {
  if (email) {
    index.emailSet.add(String(email).trim().toLowerCase());
  }
  const keys = buildPhoneKeys(phone, isoCode || null);
  for (const key of keys) {
    index.phoneSet.add(key);
  }
}

function hasDuplicate(index, { email, phoneLocalNumber, phoneForDuplicateCheck }) {
  const emailDup = email
    ? index.emailSet.has(String(email).trim().toLowerCase())
    : false;

  const rowPhoneKeys = new Set();
  if (phoneLocalNumber) rowPhoneKeys.add(String(phoneLocalNumber));
  if (phoneForDuplicateCheck) rowPhoneKeys.add(String(phoneForDuplicateCheck));

  const phoneDup =
    rowPhoneKeys.size > 0 && [...rowPhoneKeys].some((key) => index.phoneSet.has(key));

  return emailDup || phoneDup;
}

async function buildDuplicateIndexForEvent(eventId) {
  const index = createDuplicateIndex();
  const existingRegs = await Registration.find({
    eventId,
    isDeleted: { $ne: true },
  })
    .select("email phone isoCode customFields")
    .lean();

  for (const reg of existingRegs) {
    const cf = normalizeCustomFieldsSafe(reg.customFields);
    const email = reg.email || pickEmail(cf);
    const phone = reg.phone || pickPhone(cf);
    addToDuplicateIndex(index, {
      email,
      phone,
      isoCode: reg.isoCode || null,
    });
  }

  return index;
}

module.exports = {
  buildDuplicateIndexForEvent,
  hasDuplicate,
  addToDuplicateIndex,
};
