const env = require("../config/env");
const { translateText } = require("../services/translationService");
const { pickPhone } = require("../utils/customFieldUtils");

async function buildSurveyInvitationEmail({
  event,
  form,
  recipient,
  registration = {},
}) {
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

  // ---------------------------------------
  // Survey link (no token for anonymous)
  // ---------------------------------------
  const surveyLink = form.isAnonymous
    ? `${env.client.url}${env.client.surveyGuru}/${form.slug}`
    : `${env.client.url}${env.client.surveyGuru}/${form.slug}?token=${encodeURIComponent(
        recipient.token
      )}`;

  // ---------------------------------------
  // Participant Fields (ONLY if NOT anonymous)
  // ---------------------------------------
  let participantFields = [];

  if (!form.isAnonymous) {
    const customFields =
      registration.customFields && typeof registration.customFields === "object"
        ? registration.customFields
        : {};

    // Event custom fields
    if (
      Array.isArray(event.formFields) &&
      Object.keys(customFields).length > 0
    ) {
      for (const f of event.formFields) {
        const val = customFields[f.inputName];
        if (val) {
          participantFields.push({ label: f.inputName, value: val });
        }
      }
    } else {
      // fallback
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
  }

  // ---------------------------------------
  // TRANSLATION LIST (everything goes here)
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
    "Guest",
    "This survey is 100% anonymous.",
    "Your name, email and personal details are NOT recorded.",

    // dynamic event content
    event.name,
    event.venue,
    event.description || "",

    // participant label translations
    ...participantFields.map((f) => f.label),
  ].filter(Boolean);

  const results = await translateText(texts, targetLang);
  const map = {};
  texts.forEach((t, i) => (map[t] = results[i] || t));
  const tr = (t) => map[t] || t;

  // ---------------------------------------
  // HTML TEMPLATE
  // ---------------------------------------
  const html = `
  <div dir="${emailDir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      
      <div style="background:#004aad;padding:24px;text-align:center;">
        ${
          event.logoUrl
            ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;" />`
            : ""
        }
        <h2 style="color:#fff;font-size:22px;margin:0;">${tr(
          "We value your feedback!"
        )}</h2>
      </div>

      <div style="padding:32px 28px 24px;">
        <p style="font-size:15px;color:#333;">
          ${tr("Hello")} <strong>${
    form.isAnonymous ? tr("Guest") : recipient.fullName || tr("Guest")
  }</strong>,
        </p>

        <p style="font-size:15px;color:#333;line-height:1.6;">
          ${tr("We appreciate your participation in")}
          <strong>${tr(event.name)}</strong>.
          ${tr(
            "Please take a moment to share your experience and help us improve."
          )}
        </p>

        <!-- Anonymous Notice -->
        ${
          form.isAnonymous
            ? `
        <div style="margin-top:24px;padding:12px;background:#fff7d1;border-left:4px solid #f0c200;
                    font-size:14px;color:#7a5e00;">
          <strong>${tr("This survey is 100% anonymous.")}</strong><br/>
          ${tr("Your name, email and personal details are NOT recorded.")}
        </div>`
            : ""
        }

        <!-- Event Details -->
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr(
          "Event Details"
        )}</h3>
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td><strong>${tr("Date")}:</strong></td>
            <td>${formatDate(event.startDate)}</td>
          </tr>
          <tr>
            <td><strong>${tr("Venue")}:</strong></td>
            <td>${tr(event.venue || "-")}</td>
          </tr>
          ${
            event.description
              ? `<tr><td><strong>${tr("About")}:</strong></td><td>${tr(
                  event.description
                )}</td></tr>`
              : ""
          }
        </table>

        <!-- Participant Details -->
        ${
          !form.isAnonymous && participantFields.length
            ? `
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr(
          "Participant Details"
        )}</h3>
        <table style="width:100%;font-size:14px;color:#333;">
          ${participantFields
            .map(
              (f) =>
                `<tr><td><strong>${tr(f.label)}:</strong></td><td>${f.value}</td></tr>`
            )
            .join("")}
        </table>`
            : ""
        }

        <!-- Button -->
        <div style="text-align:center;margin:36px 0 20px;">
          <a href="${surveyLink}"
             style="background:#004aad;color:#fff;padding:14px 26px;border-radius:6px;
                    font-weight:600;font-size:15px;text-decoration:none;">
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
