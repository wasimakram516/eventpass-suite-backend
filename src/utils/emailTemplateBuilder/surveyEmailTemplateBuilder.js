const env = require("../../config/env");
const { translateText } = require("../../services/translationService");
const { pickPhone } = require("../customFieldUtils");

async function buildSurveyInvitationEmail({
  event,
  form,
  recipient,
  registration = {},
}) {
  const targetLang = form.defaultLanguage || "en";
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
  const baseUrl = `${env.client.url}${env.client.surveyGuru}/${targetLang}/${form.slug}`;

  const surveyLink = form.isAnonymous
    ? baseUrl
    : `${baseUrl}?token=${encodeURIComponent(recipient.token)}`;

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
        participantFields.push({
          label: "Full Name",
          value: recipient.fullName,
        });
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

  const customSubject = (form.emailSubject || "").trim();
  const headerTitle = customSubject || tr("We value your feedback!");
  const rawGreeting = (form.greetingMessage || "").trim();
  const hasCustomGreeting =
    rawGreeting &&
    rawGreeting.replace(/<[^>]+>/g, "").trim().length > 0;
  const customGreetingHtml = hasCustomGreeting ? rawGreeting : "";

  // ---------------------------------------
  // HTML TEMPLATE
  // ---------------------------------------
  const html = `
  <div dir="${emailDir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      
      <!-- HEADER -->
      <div style="background:#004aad;padding:24px;text-align:center;">
        ${
          event.logoUrl
            ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;" />`
            : ""
        }
        <h2 style="color:#fff;font-size:22px;margin:0;">${headerTitle}</h2>
      </div>

    <!-- TOP BUTTON -->
<div style="padding:28px 28px 0;text-align:center;">
  <a href="${surveyLink}"
     style="
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
       text-decoration:none;
       border:1px solid #003b87;
       box-shadow:0 4px 10px rgba(0,0,0,0.18);
       transition:all 0.2s ease-in-out;

       /* Simulated hover/active (works as visual state even without events) */
       mso-padding-alt:0;
     "
  >
     <img 
        src="${env.aws.cloudfrontUrl}/Assets/verified-user.png"
        width="22"
        height="22"
        style="display:inline-block;vertical-align:middle;"
        alt="icon"
     />

     <span style="vertical-align:middle;">
        ${targetLang === "ar" ? "افتح الاستبيان" : "Open Survey"}
     </span>
  </a>
</div>



      <!-- CONTENT BODY -->
      <div style="padding:24px 28px 28px;">
        <p style="font-size:15px;color:#333;margin-top:28px;">
          ${tr("Hello")} <strong>${
    form.isAnonymous ? tr("Guest") : recipient.fullName || tr("Guest")
  }</strong>,
        </p>

        ${
          customGreetingHtml
            ? `<div style="font-size:15px;color:#333;line-height:1.6;">${customGreetingHtml}</div>`
            : `
        <p style="font-size:15px;color:#333;line-height:1.6;">
          ${tr("We appreciate your participation in")} 
          <strong>${tr(event.name)}</strong>.
          ${tr(
            "Please take a moment to share your experience and help us improve."
          )}
        </p>
        `
        }

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
                `<tr><td><strong>${tr(f.label)}:</strong></td><td>${
                  f.value
                }</td></tr>`
            )
            .join("")}
        </table>`
            : ""
        }

        <!-- FOOTER -->
        <p style="text-align:center;font-size:14px;color:#777;margin-top:24px;">
          ${tr("Thank you for attending!")}
        </p>
      </div>
    </div>
  </div>`;

  const subject = customSubject
    ? `${customSubject} – ${tr(event.name)}`
    : `${tr("We value your feedback!")} – ${tr(event.name)}`;
  return { subject, html };
}

module.exports = { buildSurveyInvitationEmail };
