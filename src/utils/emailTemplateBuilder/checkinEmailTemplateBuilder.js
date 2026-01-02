const env = require("../../config/env");
const { translateText } = require("../../services/translationService");
const { pickPhone } = require("../customFieldUtils");
const QRCode = require("qrcode");

async function buildCheckInInvitationEmail({
  event,
  registration = {},
  displayName,
  isReminder = false,
}) {
  const targetLang = event.defaultLanguage || "en";
  const emailDir = targetLang === "ar" ? "rtl" : "ltr";

  let qrCodeDataUrl = null;
  if (registration.token) {
    qrCodeDataUrl = await QRCode.toDataURL(registration.token);
  }

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

  // Format date range (from start to end)
  const s = new Date(event.startDate);
  const e = event.endDate && new Date(event.endDate);
  const startStr = formatDate(s);
  const endStr = e && e.getTime() !== s.getTime() ? formatDate(e) : null;
  const dateRange = endStr
    ? (targetLang === "ar" ? `${startStr} إلى ${endStr}` : `${startStr} to ${endStr}`)
    : startStr;

  // ---------------------------------------
  // CheckIn confirmation link with token
  // ---------------------------------------
  const confirmationLink = registration.token
    ? `${env.client.url}/checkin/event/${event.slug}?token=${encodeURIComponent(registration.token)}`
    : `${env.client.url}/checkin/event/${event.slug}`;

  // ---------------------------------------
  // Participant Fields
  // ---------------------------------------
  let participantFields = [];

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
    if (registration.fullName)
      participantFields.push({
        label: "Full Name",
        value: registration.fullName,
      });
    if (registration.email)
      participantFields.push({ label: "Email", value: registration.email });
    if (registration.company)
      participantFields.push({ label: "Company", value: registration.company });

    const phone =
      registration.phone || pickPhone?.(registration.customFields) || null;
    if (phone) participantFields.push({ label: "Phone", value: phone });
  }

  // ---------------------------------------
  // TRANSLATION LIST (everything goes here)
  // ---------------------------------------
  const texts = [
    "Reminder: ",
    "Confirmation for the Event",
    "Hello",
    "This email is regarding your invitation to",
    "Kindly confirm your availability to attend using the button below.",
    "Event Details",
    "Participant Details",
    "Date",
    "Venue",
    "About",
    "Confirm your attendance",
    "Kindly present this QR code at the event entrance for verification.",
    "Your access token is",
    "Guest",

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
  // HTML TEMPLATE (same as surveyEmailTemplateBuilder)
  // ---------------------------------------
  const html = `
  <div dir="${emailDir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      
      <!-- HEADER -->
      <div style="background:#004aad;padding:24px;text-align:center;">
        ${event.logoUrl
      ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;" />`
      : ""
    }
        <h2 style="color:#fff;font-size:22px;margin:0;">${tr(
      "Confirmation for the Event"
    )}</h2>
      </div>

      <!-- CONTENT BODY -->
      <div style="padding:24px 28px 28px;">
        
        <p style="font-size:15px;color:#333;margin-top:28px;">
          ${tr("Hello")} <strong>${displayName}</strong>,</p>
        </p>

        <p style="font-size:15px;color:#333;line-height:1.6;">
          ${tr("This email is regarding your invitation to")} <strong>${tr(event.name)}</strong>. ${tr("Kindly confirm your availability to attend using the button below.")}
        </p>

    <!-- CONFIRM BUTTON -->
    <div style="padding:28px 0;text-align:center;">
      <a href="${confirmationLink}" style="text-decoration:none;display:inline-block;">
        <div style="
            background:#004aad;
            color:#ffffff;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            gap:10px;
            padding:16px 32px;
            border-radius:10px;
            font-weight:700;
            font-size:17px;
            border:1px solid #003b87;
            box-shadow:0 4px 10px rgba(0,0,0,0.18);
            cursor:pointer;
          "
        >
          <img 
              src="${env.aws.cloudfrontUrl}/Assets/RegisterIcon.png"
              width="22"
              height="22"
              style="display:inline-block;vertical-align:middle;margin-right:10px;"
              alt="icon"
          />

          <span style="vertical-align:middle;">
              ${tr("Confirm your attendance")}
          </span>
        </div>
      </a>
    </div>

        ${qrCodeDataUrl
      ? `
        <!-- QR Code Section -->
        <p style="font-size:15px;color:#333;line-height:1.6;margin-top:24px;text-align:center;">
          ${tr("Kindly present this QR code at the event entrance for verification")}
        </p>
        ${registration.token
        ? `<p style="font-size:15px;color:#333;line-height:1.6;text-align:center;">
              ${tr("Your access token is")} <strong>${registration.token}</strong>.
            </p>`
        : ""
      }
        <div style="text-align:center;margin:20px 0;">
          <img src="cid:qrcode" alt="QR Code" style="width:180px;display:block;margin:0 auto;" />
        </div>
        `
      : ""
    }

        <!-- Event Details -->
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr(
      "Event Details"
    )}</h3>
        <table style="width:100%;font-size:14px;color:#333;">
          <tr>
            <td><strong>${tr("Date")}:</strong></td>
            <td>${dateRange}</td>
          </tr>
          <tr>
            <td><strong>${tr("Venue")}:</strong></td>
            <td>${tr(event.venue || "-")}</td>
          </tr>
          ${event.description
      ? `<tr><td><strong>${tr("About")}:</strong></td><td>${tr(
        event.description
      )}</td></tr>`
      : ""
    }
        </table>

        <!-- Participant Details -->
        ${participantFields.length
      ? `
        <h3 style="margin-top:24px;font-size:17px;color:#004aad;">${tr(
        "Participant Details"
      )}</h3>
        <table style="width:100%;font-size:14px;color:#333;">
          ${participantFields
        .map(
          (f) =>
            `<tr><td><strong>${tr(f.label)}:</strong></td><td>${f.value
            }</td></tr>`
        )
        .join("")}
        </table>`
      : ""
    }

        <!-- FOOTER -->
        <p style="text-align:center;font-size:14px;color:#777;margin-top:24px;">
          ${tr("Confirm your attendance")}
        </p>
      </div>
    </div>
  </div>`;

  const baseSubject = `${tr("Confirmation for the Event - ")} ${tr(event.name)}`;
  const subject = isReminder ? `${tr("Reminder - ")}${baseSubject}` : baseSubject;

  return { subject, html, qrCodeDataUrl };
}

module.exports = { buildCheckInInvitationEmail };

