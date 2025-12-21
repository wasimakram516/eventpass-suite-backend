const QRCode = require("qrcode");
const { translateText } = require("../services/translationService");

async function buildRegistrationEmail({
  event,
  registration,
  displayName,
  isReminder = false,
  customFields = {},
}) {
  const targetLang = event.defaultLanguage || "en";
  const emailDir = targetLang === "ar" ? "rtl" : "ltr";
  const qrCodeDataUrl = await QRCode.toDataURL(registration.token);

  // Arabic date formatter helper
  const formatDate = (date) => {
    if (!date) return "";
    if (targetLang === "ar") {
      return new Intl.DateTimeFormat("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(date);
    }
    // default (English)
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // --- Format date range ---
  const s = new Date(event.startDate);
  const e = event.endDate && new Date(event.endDate);
  const startStr = formatDate(s);
  const endStr = e && e.getTime() !== s.getTime() ? formatDate(e) : null;
  const dateRange = endStr ? `${startStr} – ${endStr}` : startStr;

  // --- Collect static phrases + event text for translation ---
  const textsToTranslate = [
    "Welcome to",
    "Hi",
    "You're confirmed for",
    "Event Details:",
    "Date:",
    "Venue:",
    "About:",
    "Please present this QR at check-in:",
    "Your Token:",
    "Questions? Reply to this email.",
    "See you soon!",
    "Registration Confirmed:",
    "Here are your submitted details:",
    event.name,
    event.venue,
    event.description || "",
    dateRange,
  ].filter(Boolean);

  // --- Also include form field labels (not user values) ---
  const formLabels = Array.isArray(event.formFields)
    ? event.formFields.map((f) => f.inputName)
    : [];
  textsToTranslate.push(...formLabels);

  // --- Translate all in one batch ---
  const results = await translateText(textsToTranslate, targetLang);
  const map = {};
  textsToTranslate.forEach((t, i) => (map[t] = results[i] || t));
  const tr = (t) => map[t] || t;

  // --- Build custom fields section (translate only labels) ---
  let customFieldHtml = "";
  if (Object.keys(customFields).length && Array.isArray(event.formFields)) {
    const filledFields = event.formFields.filter(
      (f) => customFields[f.inputName]
    );
    const items = filledFields
      .map((f) => {
        const v = customFields[f.inputName]; // user-entered value — not translated
        const translatedLabel = tr(f.inputName);
        return `<li><strong>${translatedLabel}:</strong> ${v}</li>`;
      })
      .join("");

    if (items) {
      const sectionLabel = tr("Here are your submitted details:");
      const pad =
        targetLang === "ar" ? "padding-right:20px;" : "padding-left:20px;";
      customFieldHtml = `<p style="font-size:16px;">${sectionLabel}</p>
      <ul style="font-size:15px;line-height:1.6;${pad}">${items}</ul>`;
    }
  }

  // --- Compose email HTML ---
  const html = `
<div dir="${emailDir}" style="font-family:Arial,sans-serif;padding:20px;background:#f4f4f4;color:#333">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#007BFF;padding:20px;text-align:center">
      <h2 style="color:#fff;margin:0">${tr("Welcome to")} ${tr(event.name)}</h2>
    </div>
    <div style="padding:30px">
      <p>${tr("Hi")} <strong>${displayName}</strong>,</p>
      <p>${tr("You're confirmed for")} <strong>${tr(event.name)}</strong>!</p>
      ${
        event.logoUrl
          ? `<div style="text-align:center;margin:20px 0">
              <img src="${event.logoUrl}" style="max-width:180px;max-height:100px"/>
            </div>`
          : ""
      }
      <p>${tr("Please present this QR at check-in:")}</p>
      <div style="text-align:center;margin:20px auto;width:100%;">{{qrImage}}</div>
      <p>${tr("Your Token:")} <strong>${registration.token}</strong></p>
      <p>${tr("Event Details:")}</p>
      <ul style="${
        targetLang === "ar" ? "padding-right:20px;" : "padding-left:20px;"
      }">
        <li><strong>${tr("Date:")}</strong> ${tr(dateRange)}</li>
        <li><strong>${tr("Venue:")}</strong> ${tr(event.venue)}</li>
        ${
          event.description
            ? `<li><strong>${tr("About:")}</strong> ${tr(
                event.description
              )}</li>`
            : ""
        }
      </ul>
      ${customFieldHtml}
      <hr/>
      <p>${tr("Questions? Reply to this email.")}</p>
      <p>${tr("See you soon!")}</p>
    </div>
  </div>
</div>`;

  const baseSubject = `${tr("Registration Confirmed:")} ${tr(event.name)}`;
  const subject = isReminder ? `Reminder: ${baseSubject}` : baseSubject;

  return { subject, html, qrCodeDataUrl };
}

module.exports = { buildRegistrationEmail };
