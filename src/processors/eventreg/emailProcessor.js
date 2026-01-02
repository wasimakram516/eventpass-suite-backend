const Registration = require("../../models/Registration");
const { buildRegistrationEmail } = require("../../utils/emailTemplateBuilder");
const sendEmail = require("../../services/emailService");

const {
  pickEmail,
  pickFullName,
  pickCompany,
} = require("../../utils/customFieldUtils");

const {
  emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");

module.exports = async function emailProcessor(event, recipients, customEmail = null) {
  const eventId = event._id.toString();
  const total = recipients.length;

  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    for (const r of recipients) {
      processed++;

      try {
        const reg = await Registration.findById(r._id)
          .select("customFields fullName email phone company token _id eventId")
          .lean();

        let cf = {};
        if (reg?.customFields) {
          if (Array.isArray(reg.customFields)) {
            cf = Object.fromEntries(reg.customFields);
          } else if (typeof reg.customFields === "object") {
            cf = reg.customFields;
          }
        }

        const email = r.email || reg?.email || pickEmail(cf) || null;

        const fullName =
          r.fullName || reg?.fullName || pickFullName(cf) || null;

        const company = r.company || reg?.company || pickCompany(cf) || "";

        if (!email) {
          failed++;
          continue;
        }

        const displayName =
          fullName || (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

        const isReminder = r.emailSent === true;


        let subject, html, qrCodeDataUrl;
        if (customEmail?.subject && customEmail?.body) {
          const targetLang = event.defaultLanguage || "en";
          const emailDir = targetLang === "ar" ? "rtl" : "ltr";

          const welcomeText = targetLang === "ar" ? "مرحباً بكم في" : "Welcome to";
          const headerText = `${welcomeText} ${event.name}`;

          html = `
            <div dir="${emailDir}" style="font-family:'Segoe UI',Arial,sans-serif;background:#f6f8fa;padding:20px;">
              <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
                
                <!-- HEADER -->
                <div style="background:#004aad;padding:24px;text-align:center;">
                  ${event.logoUrl
              ? `<img src="${event.logoUrl}" alt="Event Logo" style="max-width:140px;max-height:80px;margin-bottom:10px;" />`
              : ""
            }
                  <h2 style="color:#fff;font-size:22px;margin:0;">${headerText}</h2>
                </div>

                <!-- CONTENT BODY (Custom HTML from CMS) -->
                <div style="padding:24px 28px 28px;">
                  ${customEmail.body}
                </div>
              </div>
            </div>`;

          subject = customEmail.subject;
        } else {
          const emailTemplateResult = await buildRegistrationEmail({
            event,
            registration: {
              ...reg,
              customFields: cf,
              fullName,
              email,
              company,
            },
            customFields: cf,
            displayName,
            isReminder,
          });
          subject = emailTemplateResult.subject;
          html = emailTemplateResult.html;
          qrCodeDataUrl = emailTemplateResult.qrCodeDataUrl;
        }

        const attachments = [];
        if (customEmail?.mediaUrl) {
          const filename = customEmail.originalFilename || (() => {
            const urlParts = customEmail.mediaUrl.split("/");
            return urlParts[urlParts.length - 1] || "attachment";
          })();
          attachments.push({ filename, path: customEmail.mediaUrl });
        }

        const result = await sendEmail(email, subject, html, qrCodeDataUrl, attachments);

        if (result.success) {
          if (!isReminder) {
            await Registration.updateOne({ _id: r._id }, { emailSent: true });
          }

          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error("Email send error:", err);
        failed++;
      }

      emitEmailProgress(eventId, {
        sent,
        failed,
        processed,
        total,
      });

      await new Promise((r) => setTimeout(r, 20));
    }

    emitEmailProgress(eventId, {
      sent,
      failed,
      processed: total,
      total,
    });
  } catch (err) {
    console.error("EMAIL PROCESSOR ERROR:", err);
  }
};
