// utils/customFieldUtils.js

/**
 * Pick a value from a customFields object by matching its key case-insensitively.
 * @param {Object<string, any>} customFields
 * @param {RegExp} regex – e.g. /^email$/i
 * @returns {any|null}
 */
function pickCustom(customFields, regex) {
  if (!customFields || typeof customFields !== "object") return null;
  for (const key of Object.keys(customFields)) {
    if (regex.test(key)) return customFields[key];
  }
  return null;
}

/** Shorthand helpers **/
function pickFullName(fields) {
  return pickCustom(fields, /^(full\s*name|name)$/i);
}
function pickEmail(fields) {
  return pickCustom(fields, /^email$/i);
}
function pickPhone(fields) {
  return pickCustom(fields, /^phone$/i);
}
function pickCompany(fields) {
  return pickCustom(fields, /^company$/i);
}

module.exports = {
  pickCustom,
  pickFullName,
  pickEmail,
  pickPhone,
  pickCompany,
};
