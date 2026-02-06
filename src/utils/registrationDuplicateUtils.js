const { pickEmail, pickPhone } = require("./customFieldUtils");
const { normalizePhone } = require("./whatsappProcessorUtils");
const {
  extractCountryCodeAndIsoCode,
  combinePhoneWithCountryCode,
  DEFAULT_ISO_CODE,
} = require("./countryCodes");

function normalizeCustomFields(cf) {
  if (!cf) return {};
  if (cf instanceof Map) return Object.fromEntries(cf);
  if (typeof cf.toObject === "function") return cf.toObject();
  return cf;
}

function buildDuplicateOr({
  hasCustomFields,
  formFields,
  extractedEmail,
  phoneForDuplicateCheck,
  phoneLocalNumber,
  phoneIsoCode,
  includeEmail = true,
  includePhone = true,
  alsoClassic = false,
}) {
  const duplicateOr = [];

  if (hasCustomFields) {
    const emailField = formFields.find((f) => f.inputType === "email");
    const phoneField = formFields.find(
      (f) => f.inputType === "phone" || f.inputName?.toLowerCase().includes("phone")
    );

    if (
      includeEmail &&
      emailField &&
      extractedEmail &&
      String(extractedEmail).trim()
    ) {
      duplicateOr.push({ [`customFields.${emailField.inputName}`]: extractedEmail });
    }
    if (
      includePhone &&
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

    if (alsoClassic) {
      if (includeEmail && extractedEmail && String(extractedEmail).trim()) {
        duplicateOr.push({ email: extractedEmail });
      }
      if (
        includePhone &&
        phoneForDuplicateCheck &&
        String(phoneForDuplicateCheck).trim()
      ) {
        duplicateOr.push({ phone: phoneForDuplicateCheck });
        if (phoneLocalNumber && phoneIsoCode) {
          duplicateOr.push({
            $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }],
          });
        }
      }
    }
  } else {
    if (includeEmail && extractedEmail && String(extractedEmail).trim()) {
      duplicateOr.push({ email: extractedEmail });
    }
    if (
      includePhone &&
      phoneForDuplicateCheck &&
      String(phoneForDuplicateCheck).trim()
    ) {
      duplicateOr.push({ phone: phoneForDuplicateCheck });
      if (phoneLocalNumber && phoneIsoCode) {
        duplicateOr.push({
          $and: [{ phone: phoneLocalNumber }, { isoCode: phoneIsoCode }],
        });
      }
    }
  }

  return duplicateOr;
}

function buildRestoreDuplicateFilter(event, reg) {
  const formFields = event.formFields || [];
  const hasCustomFields = formFields.length > 0;
  const cf = normalizeCustomFields(reg.customFields);

  const extractedEmail = hasCustomFields ? pickEmail(cf) : reg.email;
  const extractedPhone = hasCustomFields ? pickPhone(cf) : reg.phone;

  const normalizedPhone = extractedPhone ? normalizePhone(extractedPhone) : null;
  let phoneIsoCode = reg.isoCode || null;
  let phoneLocalNumber = null;
  let phoneForDuplicateCheck = null;

  if (normalizedPhone) {
    phoneLocalNumber = normalizedPhone;
    phoneForDuplicateCheck = normalizedPhone;

    if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
      phoneForDuplicateCheck =
        combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
    } else if (normalizedPhone.startsWith("+")) {
      const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
      if (extracted.isoCode) {
        phoneLocalNumber = extracted.localNumber;
        if (!phoneIsoCode) {
          phoneIsoCode = extracted.isoCode;
        }
        phoneForDuplicateCheck = normalizedPhone;
      } else if (!phoneIsoCode) {
        phoneIsoCode = DEFAULT_ISO_CODE;
        phoneForDuplicateCheck =
          combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
      }
    } else if (!phoneIsoCode) {
      phoneIsoCode = DEFAULT_ISO_CODE;
      phoneForDuplicateCheck =
        combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
    }
  }

  const duplicateOr = buildDuplicateOr({
    hasCustomFields,
    formFields,
    extractedEmail,
    phoneForDuplicateCheck,
    phoneLocalNumber,
    phoneIsoCode,
  });

  if (!duplicateOr.length) return null;

  return {
    eventId: event._id,
    _id: { $ne: reg._id },
    $or: duplicateOr,
  };
}

function buildPhoneDuplicateCheck(phoneRaw, isoCode) {
  const normalizedPhone = phoneRaw ? normalizePhone(phoneRaw) : null;
  let phoneLocalNumber = null;
  let phoneForDuplicateCheck = null;
  let phoneIsoCode = isoCode || null;

  if (!normalizedPhone) {
    return { phoneLocalNumber: null, phoneForDuplicateCheck: null };
  }

  if (!normalizedPhone.startsWith("+") && phoneIsoCode) {
    phoneLocalNumber = normalizedPhone;
    phoneForDuplicateCheck =
      combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
  } else if (normalizedPhone.startsWith("+")) {
    const extracted = extractCountryCodeAndIsoCode(normalizedPhone);
    if (extracted.isoCode) {
      phoneLocalNumber = extracted.localNumber;
      phoneIsoCode = extracted.isoCode;
      phoneForDuplicateCheck = normalizedPhone;
    } else if (!phoneIsoCode) {
      phoneIsoCode = DEFAULT_ISO_CODE;
      phoneForDuplicateCheck =
        combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
    } else {
      phoneForDuplicateCheck =
        combinePhoneWithCountryCode(normalizedPhone, phoneIsoCode) || normalizedPhone;
    }
  } else {
    phoneIsoCode = phoneIsoCode || DEFAULT_ISO_CODE;
    phoneLocalNumber = normalizedPhone;
    phoneForDuplicateCheck =
      combinePhoneWithCountryCode(phoneLocalNumber, phoneIsoCode) || normalizedPhone;
  }

  return { phoneLocalNumber, phoneForDuplicateCheck };
}

module.exports = {
  normalizeCustomFields,
  buildDuplicateOr,
  buildRestoreDuplicateFilter,
  buildPhoneDuplicateCheck,
};
