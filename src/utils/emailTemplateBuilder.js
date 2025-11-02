/**
 * Builds bilingual registration email HTML and subject line.
 * Returns { subject, html }.
 */

const QRCode = require("qrcode");
const { translate } = require("google-translate-api-x");

/**
 * @param {object} opts
 * @param {object} opts.event - Event document
 * @param {object} opts.registration - Registration document
 * @param {string} opts.displayName - Name to show in email
 * @param {object} [opts.customFields={}] - Map of custom field key/value pairs
 * @returns {Promise<{ subject: string, html: string }>}
 */
async function buildRegistrationEmail({
  event,
  registration,
  displayName,
  customFields = {},
}) {
  const isArabic = event.defaultLanguage === "ar";
  const emailDir = isArabic ? "rtl" : "ltr";
  const qrCodeDataUrl = await QRCode.toDataURL(registration.token);

  // --- Build custom fields section ---
  let customFieldHtml = "";
  if (Object.keys(customFields).length && Array.isArray(event.formFields)) {
    const items = event.formFields
      .map((f) => {
        const v = customFields[f.inputName];
        return v ? `<li><strong>${f.inputName}:</strong> ${v}</li>` : "";
      })
      .filter(Boolean)
      .join("");
    if (items) {
      const label = isArabic
        ? "إليك التفاصيل المقدمة:"
        : "Here are your submitted details:";
      const pad = isArabic ? "padding-right:20px;" : "padding-left:20px;";
      customFieldHtml = `<p style="font-size:16px;">${label}</p>
      <ul style="font-size:15px;line-height:1.6;${pad}">${items}</ul>`;
    }
  }

  // --- Prepare date range ---
  const dateRange =
    event.endDate && event.endDate.getTime() !== event.startDate.getTime()
      ? `${event.startDate.toDateString()} to ${event.endDate.toDateString()}`
      : event.startDate.toDateString();
  let translatedDateRange = dateRange;

  // --- Translations (Arabic) ---
  let translatedEventName = event.name;
  let translatedVenue = event.venue;
  let translatedDescription = event.description || "";
  let translatedDisplayName = displayName;

  if (isArabic) {
    try {
      const [nameRes, venueRes, descRes, displayRes] = await Promise.all([
        translate(event.name, { to: "ar" }),
        translate(event.venue, { to: "ar" }),
        event.description
          ? translate(event.description, { to: "ar" })
          : Promise.resolve(null),
        displayName !== "Guest"
          ? translate(displayName, { to: "ar" })
          : Promise.resolve(null),
      ]);

      translatedEventName = nameRes.text;
      translatedVenue = venueRes.text;
      if (descRes) translatedDescription = descRes.text;
      if (displayRes) translatedDisplayName = displayRes.text;
      else if (displayName === "Guest") translatedDisplayName = "ضيف";

      // Arabic date formatting
      const months = {
        January: "يناير",
        February: "فبراير",
        March: "مارس",
        April: "أبريل",
        May: "مايو",
        June: "يونيو",
        July: "يوليو",
        August: "أغسطس",
        September: "سبتمبر",
        October: "أكتوبر",
        November: "نوفمبر",
        December: "ديسمبر",
      };
      const days = {
        Sunday: "الأحد",
        Monday: "الاثنين",
        Tuesday: "الثلاثاء",
        Wednesday: "الأربعاء",
        Thursday: "الخميس",
        Friday: "الجمعة",
        Saturday: "السبت",
      };
      const toArabicDigits = (num) =>
        String(num).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
      const fmt = (d) => {
        const day = days[d.toLocaleDateString("en-US", { weekday: "long" })];
        const month = months[d.toLocaleDateString("en-US", { month: "long" })];
        const dateNum = toArabicDigits(d.getDate());
        const year = toArabicDigits(d.getFullYear());
        return `${day}، ${dateNum} ${month} ${year}`;
      };
      const s = new Date(event.startDate);
      const e = event.endDate ? new Date(event.endDate) : null;
      translatedDateRange =
        e && e.getTime() !== s.getTime() ? `${fmt(s)} إلى ${fmt(e)}` : fmt(s);
    } catch (err) {
      console.error("Arabic translation error:", err);
    }
  }

  // --- Text dictionary ---
  const emailTexts = isArabic
    ? {
        welcome: `أهلاً بك في ${translatedEventName}`,
        greeting: `مرحباً <strong>${translatedDisplayName}</strong>،`,
        confirmed: `تم تأكيد تسجيلك في <strong>${translatedEventName}</strong>!`,
        eventDetails: "تفاصيل الفعالية:",
        date: "التاريخ:",
        venue: "المكان:",
        about: "نبذة:",
        qrPrompt: "يرجى تقديم رمز الاستجابة السريعة هذا عند تسجيل الدخول:",
        token: "رمزك:",
        questions: "لديك أسئلة؟ قم بالرد على هذا البريد الإلكتروني.",
        seeYou: "نراكم قريباً!",
      }
    : {
        welcome: `Welcome to ${translatedEventName}`,
        greeting: `Hi <strong>${displayName}</strong>,`,
        confirmed: `You're confirmed for <strong>${translatedEventName}</strong>!`,
        eventDetails: "Event Details:",
        date: "Date:",
        venue: "Venue:",
        about: "About:",
        qrPrompt: "Please present this QR at check-in:",
        token: "Your Token:",
        questions: "Questions? Reply to this email.",
        seeYou: "See you soon!",
      };

  const finalDateRange = isArabic ? translatedDateRange : dateRange;

  // --- Build email HTML ---
  const html = `
<div dir="${emailDir}" style="font-family:Arial,sans-serif;padding:20px;background:#f4f4f4;color:#333">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#007BFF;padding:20px;text-align:center">
      <h2 style="color:#fff;margin:0">${emailTexts.welcome}</h2>
    </div>
    <div style="padding:30px">
      <p>${emailTexts.greeting}</p>
      <p>${emailTexts.confirmed}</p>
      ${
        event.logoUrl
          ? `<div style="text-align:center;margin:20px 0">
          <img src="${event.logoUrl}" style="max-width:180px;max-height:100px"/>
        </div>`
          : ""
      }
      <p>${emailTexts.qrPrompt}</p>
      <div style="text-align:center;margin:20px auto;display:block;width:100%;">{{qrImage}}</div>
      <p>${emailTexts.token} <strong>${registration.token}</strong></p>
      <p>${emailTexts.eventDetails}</p>
      <ul style="${isArabic ? "padding-right:20px;" : "padding-left:20px;"}">
        <li><strong>${emailTexts.date}</strong> ${finalDateRange}</li>
        <li><strong>${emailTexts.venue}</strong> ${translatedVenue}</li>
        ${
          translatedDescription
            ? `<li><strong>${emailTexts.about}</strong> ${translatedDescription}</li>`
            : ""
        }
      </ul>
      ${customFieldHtml}
      <hr/>
      <p>${emailTexts.questions}</p>
      <p>${emailTexts.seeYou}</p>
    </div>
  </div>
</div>`;

  const subject = isArabic
    ? `تأكيد التسجيل: ${translatedEventName}`
    : `Registration Confirmed: ${translatedEventName}`;

  return { subject, html, qrCodeDataUrl };
}

module.exports = { buildRegistrationEmail };
