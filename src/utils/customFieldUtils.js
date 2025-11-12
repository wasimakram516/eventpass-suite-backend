function normalize(str = "") {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(customFields, matchKey, extraKeys = []) {
  if (!customFields || typeof customFields !== "object") return null;

  const target = normalize(matchKey);
  const candidates = new Set([target, ...extraKeys.map(normalize)]);

  for (const [origKey, val] of Object.entries(customFields)) {
    const nk = normalize(origKey);
    if (candidates.has(nk)) return val;
  }
  return null;
}

function pickCustomFieldPairs(fields) {
  if (!fields || typeof fields !== "object") return [];

  const pairs = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && String(value).trim() !== "") {
      pairs.push({ label: key, value: String(value).trim() });
    }
  }
  return pairs;
}

function pickFullName(fields) {
  if (!fields) return null;

  // Try "Full Name" first
  const fn = pick(fields, "fullname", ["full name", "name"]);
  if (fn) return String(fn).trim();

  // Otherwise try First + Last
  const first =
    pick(fields, "firstname", ["first name", "given name"]) || null;
  const last =
    pick(fields, "lastname", ["last name", "surname"]) || null;

  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

const pickEmail = (f) => pick(f, "email", ["e-mail", "email address"]);
const pickPhone = (f) =>
  pick(f, "phone", ["phone number", "mobile", "contact", "whatsapp"]);
const pickCompany = (f) =>
  pick(f, "company", [
    "organization",
    "organisation",
    "institution",
    "institute",
    "business",
    "enterprise",
    "office",
  ]);

const pickTitle = (f) =>
  pick(f, "title", ["designation", "job title", "position", "role"]);

const pickBadgeIdentifier = (f) =>
  pick(f, "badge", ["badge id", "badge identifier", "badge number"]);

const pickWing = (f) => pick(f, "wing", ["wing name", "wing"]);

module.exports = {
  pickCustomFieldPairs,
  pickFullName,
  pickEmail,
  pickPhone,
  pickCompany,
  pickTitle,
  pickBadgeIdentifier,
  pickWing,
};
