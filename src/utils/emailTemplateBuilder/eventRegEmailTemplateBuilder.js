const QRCode = require("qrcode");
const { translateText } = require("../../services/translationService");

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

  // Arabic/English date formatter helper
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
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Format date range
  const s = new Date(event.startDate);
  const e = event.endDate && new Date(event.endDate);
  const startStr = formatDate(s);
  const endStr = e && e.getTime() !== s.getTime() ? formatDate(e) : null;
  const dateRange = endStr ? `${startStr} – ${endStr}` : startStr;

  // Collect static phrases + event text for translation
  const textsToTranslate = [
    "Reminder: ",
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

  // Also include form field labels (not user values)
  const formLabels = Array.isArray(event.formFields)
    ? event.formFields.map((f) => f.inputName)
    : [];
  textsToTranslate.push(...formLabels);

  // Translate all in one batch
  const results = await translateText(textsToTranslate, targetLang);
  const map = {};
  textsToTranslate.forEach((t, i) => (map[t] = results[i] || t));
  const tr = (t) => map[t] || t;

  // Build custom fields section (translate only labels)
  let customFieldHtml = "";
  if (Object.keys(customFields).length && Array.isArray(event.formFields)) {
    const filledFields = event.formFields.filter(
      (f) => customFields[f.inputName]
    );
    const items = filledFields
      .map((f) => {
        const v = customFields[f.inputName];
        const translatedLabel = tr(f.inputName);
        return `<tr><td style="padding:4px 0;"><strong>${translatedLabel}:</strong></td><td style="padding:4px 0;">${v}</td></tr>`;
      })
      .join("");

    if (items) {
      customFieldHtml = `
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr("Here are your submitted details:")}</h3>
        <table style="width:100%;font-size:14px;color:#333;">
          ${items}
        </table>`;
    }
  }

  // Compose email HTML (CheckIn-style UI with original EventReg content)
  const html = `
  <div dir="${emailDir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      
      <!-- HEADER -->
      <div style="background:#004aad;padding:24px;text-align:center;">
        ${event.logoUrl
      ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;" />`
      : ""
    }
        <h2 style="color:#fff;font-size:22px;margin:0;">${tr("Welcome to")} ${tr(event.name)}</h2>
      </div>

      <!-- CONTENT BODY -->
      <div style="padding:24px 28px 28px;">
        
        <p style="font-size:15px;color:#333;margin-top:28px;">
          ${tr("Hi")} <strong>${displayName}</strong>,
        </p>

        <p style="font-size:15px;color:#333;line-height:1.6;">
          ${tr("You're confirmed for")} <strong>${tr(event.name)}</strong>!
        </p>

        <!-- QR Code Section -->
        <p style="font-size:15px;color:#333;line-height:1.6;margin-top:24px;">
          ${tr("Please present this QR at check-in:")}
        </p>
        <div style="text-align:center;margin:20px 0;">
          {{qrImage}}
        </div>
        <p style="font-size:15px;color:#333;line-height:1.6;text-align:center;">
          ${tr("Your Token:")} <strong>${registration.token}</strong>
        </p>

        <!-- Event Details -->
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr("Event Details:")}</h3>
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td style="padding:4px 0;"><strong>${tr("Date:")}</strong></td>
            <td style="padding:4px 0;">${tr(dateRange)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;"><strong>${tr("Venue:")}</strong></td>
            <td style="padding:4px 0;">${tr(event.venue)}</td>
          </tr>
          ${event.description
      ? `<tr><td style="padding:4px 0;"><strong>${tr("About:")}</strong></td><td style="padding:4px 0;">${tr(event.description)}</td></tr>`
      : ""
    }
        </table>

        ${customFieldHtml}

        <!-- FOOTER -->
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="font-size:14px;color:#777;">
          ${tr("Questions? Reply to this email.")}
        </p>
        <p style="font-size:14px;color:#777;">
          ${tr("See you soon!")}
        </p>
      </div>
    </div>
  </div>`;

  const baseSubject = `${tr("Registration Confirmed:")} ${tr(event.name)}`;
  const subject = isReminder ? `${tr("Reminder: ")}${baseSubject}` : baseSubject;

  return { subject, html, qrCodeDataUrl };
}

module.exports = { buildRegistrationEmail };
