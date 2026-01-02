const Registration = require("../../models/Registration");
const sendEmail = require("../../services/emailService");
const {  buildCustomEmail,
} = require("../../utils/emailTemplateBuilder/buildCustomEmail");
const {
  buildRegistrationEmail,
} = require("../../utils/emailTemplateBuilder/eventRegEmailTemplateBuilder");

const {
  pickEmail,
  pickFullName,
  pickCompany,
} = require("../../utils/customFieldUtils");

const {
  emitEmailProgress,
} = require("../../socket/modules/eventreg/eventRegSocket");

module.exports = async function emailProcessor(
  event,
  recipients,
  customEmail = null
) {
  const eventId = event._id.toString();
  const total = recipients.length;

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    processed++;

    try {
      const reg = await Registration.findById(r._id)
        .select("customFields fullName email company token")
        .lean();

      const cf = Array.isArray(reg?.customFields)
        ? Object.fromEntries(reg.customFields)
        : reg?.customFields || {};

      const email = r.email || reg?.email || pickEmail(cf);
      if (!email) {
        failed++;
        continue;
      }

      const fullName = r.fullName || reg?.fullName || pickFullName(cf);
      const company = r.company || reg?.company || pickCompany(cf) || "";

      const displayName =
        fullName || (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

      const isReminder = r.emailSent === true;

      let subject, html, qrCodeDataUrl;

      if (customEmail?.subject && customEmail?.body) {
        // Custom email → custom template only
        ({ subject, html, qrCodeDataUrl } = buildCustomEmail({
          event,
          subject: customEmail.subject,
          bodyHtml: customEmail.body,
        }));
      } else {
        // System email → registration template
        ({ subject, html, qrCodeDataUrl } =
          await buildRegistrationEmail({
            event,
            registration: {
              ...reg,
              fullName,
              email,
              company,
            },
            displayName,
            isReminder,
            customFields: cf,
          }));
      }

      const attachments = [];
      if (customEmail?.mediaUrl) {
        attachments.push({
          filename: customEmail.originalFilename || "attachment",
          path: customEmail.mediaUrl,
        });
      }

      const result = await sendEmail(
        email,
        subject,
        html,
        qrCodeDataUrl,
        attachments
      );

      if (result.success) {
        if (!isReminder) {
          await Registration.updateOne(
            { _id: r._id },
            { emailSent: true }
          );
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
};
