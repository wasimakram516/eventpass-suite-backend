/**
 * Normalize a field name by removing non-letter characters and converting to lowercase.
 * E.g., "E-mail", "E Mail", "email_address" → "email"
 */
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Pick a value from a customFields object by fuzzy matching normalized keys.
 * @param {Object<string, any>} customFields
 * @param {string} matchKey - e.g. "email", "fullname", "phone"
 * @returns {any|null}
 */
function pickCustom(customFields, matchKey) {
  if (!customFields || typeof customFields !== "object") return null;

  const target = normalize(matchKey);

  for (const key of Object.keys(customFields)) {
    if (normalize(key) === target) return customFields[key];
  }

  return null;
}

/** Shorthand helpers **/
function pickFullName(fields) {
  return pickCustom(fields, "fullname") || pickCustom(fields, "name");
}

function pickEmail(fields) {
  return pickCustom(fields, "email");
}

function pickPhone(fields) {
  return pickCustom(fields, "phone");
}

function pickCompany(fields) {
  return pickCustom(fields, "company");
}

module.exports = {
  pickCustom,
  pickFullName,
  pickEmail,
  pickPhone,
  pickCompany,
};
