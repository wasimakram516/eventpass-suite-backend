const env = require("../config/env");
const { translateText } = require("../services/translationService");
const { pickPhone, pickCustomFieldPairs } = require("../utils/customFieldUtils");

async function buildSurveyInvitationEmail({ event, form, recipient, registration = {} }) {
  const targetLang = event.defaultLanguage || "en";
  const emailDir = targetLang === "ar" ? "rtl" : "ltr";

  // ---------------------------------------
  // Arabic / English date formatter helper
  // ---------------------------------------
  const formatDate = (date) => {
    if (!date) return "";
    const d = new Date(date);
    if (targetLang === "ar") {
      return new Intl.DateTimeFormat("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(d);
    }
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Personalized survey link with token
  const surveyLink = `${env.client.url}${env.client.surveyGuru}/${form.slug}?token=${encodeURIComponent(
    recipient.token
  )}`;

  // ---------------------------------------
  // Participant fields (prefer custom)
  // ---------------------------------------
  const hasCustomFields =
    registration.customFields &&
    typeof registration.customFields === "object" &&
    Object.keys(registration.customFields).length > 0;

  let participantFields = [];

  if (hasCustomFields) {
    const pairs = pickCustomFieldPairs(registration.customFields);
    for (const { label, value } of pairs) {
      if (label && value) participantFields.push({ label, value });
    }
  } else {
    if (recipient.fullName)
      participantFields.push({ label: "Full Name", value: recipient.fullName });
    if (recipient.email)
      participantFields.push({ label: "Email", value: recipient.email });
    if (recipient.company)
      participantFields.push({ label: "Company", value: recipient.company });
    const phone =
      registration.phone || pickPhone?.(registration.customFields) || null;
    if (phone) participantFields.push({ label: "Phone", value: phone });
  }

  // ---------------------------------------
  // Texts for translation (include all labels)
  // ---------------------------------------
  const texts = [
    "We value your feedback!",
    "Hello",
    "We appreciate your participation in",
    "Please take a moment to share your experience and help us improve.",
    "Event Details",
    "Participant Details",
    "Date",
    "Venue",
    "About",
    "Open Survey",
    "Thank you for attending!",
    event.name,
    event.venue,
    event.description || "",
    ...participantFields.map((f) => f.label),
  ].filter(Boolean);

  const results = await translateText(texts, targetLang);
  const map = {};
  texts.forEach((t, i) => (map[t] = results[i] || t));
  const tr = (t) => map[t] || t;

  // ---------------------------------------
  // Build email HTML
  // ---------------------------------------
  const html = `
  <div dir="${emailDir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      
      <!-- Header -->
      <div style="background:#004aad;padding:24px;text-align:center;">
        ${
          event.logoUrl
            ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;"/>`
            : ""
        }
        <h2 style="color:#fff;font-size:22px;margin:0;">${tr(
          "We value your feedback!"
        )}</h2>
      </div>

      <!-- Body -->
      <div style="padding:32px 28px 24px;">
        <p style="font-size:15px;color:#333;">
          ${tr("Hello")} <strong>${recipient.fullName || "Guest"}</strong>,
        </p>

        <p style="font-size:15px;color:#333;line-height:1.6;">
          ${tr("We appreciate your participation in")} <strong>${tr(
    event.name
  )}</strong>. 
          ${tr(
            "Please take a moment to share your experience and help us improve."
          )}
        </p>

        <!-- Event Details -->
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr(
          "Event Details"
        )}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
          <tr>
            <td style="padding:6px 0;"><strong>${tr("Date")}:</strong></td>
            <td>${formatDate(event.startDate)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;"><strong>${tr("Venue")}:</strong></td>
            <td>${tr(event.venue || "-")}</td>
          </tr>
          ${
            event.description
              ? `<tr>
                  <td style="padding:6px 0;vertical-align:top;"><strong>${tr(
                    "About"
                  )}:</strong></td>
                  <td>${tr(event.description)}</td>
                </tr>`
              : ""
          }
        </table>

        <!-- Participant Details -->
        ${
          participantFields.length
            ? `
          <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr(
            "Participant Details"
          )}</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
            ${participantFields
              .map(
                (f) => `
              <tr>
                <td style="padding:6px 0;width:40%;"><strong>${tr(
                  f.label
                )}:</strong></td>
                <td style="padding:6px 0;">${f.value}</td>
              </tr>`
              )
              .join("")}
          </table>`
            : ""
        }

        <!-- Button -->
        <div style="text-align:center;margin:36px 0 20px;">
          <a href="${surveyLink}" target="_blank" 
             style="background:#004aad;color:#fff;text-decoration:none;padding:14px 26px;
             border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">
             ${tr("Open Survey")}
          </a>
        </div>

        <p style="text-align:center;font-size:14px;color:#777;margin-top:16px;">
          ${tr("Thank you for attending!")}
        </p>
      </div>
    </div>
  </div>`;

  const subject = `${tr("We value your feedback!")} – ${tr(event.name)}`;
  return { subject, html };
}

module.exports = { buildSurveyInvitationEmail };
