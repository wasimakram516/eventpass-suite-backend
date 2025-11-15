const Registration = require("../../models/Registration");
const { buildRegistrationEmail } = require("../../utils/emailTemplateBuilder");
const sendEmail = require("../../services/emailService");

const { pickEmail, pickFullName, pickCompany } = require("../../utils/customFieldUtils");
const { emitEmailProgress } = require("../../socket/modules/eventreg/eventRegSocket");

module.exports = async function emailProcessor(event, recipients) {
  const eventId = event._id.toString();
  const total = recipients.length;

  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    for (const r of recipients) {
      processed++;

      try {
        const cf = r.customFields ? Object.fromEntries(r.customFields) : {};

        const fullName = r.fullName || pickFullName(cf);
        const email = r.email || pickEmail(cf);

        if (!email) {
          failed++;
          continue;
        }

        const displayName = fullName || (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

        const { subject, html, qrCodeDataUrl } = await buildRegistrationEmail({
          event,
          registration: r,
          customFields: cf,
          displayName,
        });

        const result = await sendEmail(email, subject, html, qrCodeDataUrl);

        if (result.success) {
          await Registration.updateOne({ _id: r._id }, { emailSent: true });
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      }

      emitEmailProgress(eventId, {
        sent,
        failed,
        processed,
        total,
      });

      await new Promise(r => setTimeout(r, 20));
    }

    emitEmailProgress(eventId, {
      sent,
      failed,
      processed: total,
      total,
    });

    console.log(
      `Bulk email finished: ${sent} sent, ${failed} failed, total ${total}`
    );

  } catch (err) {
    console.error("EMAIL PROCESSOR ERROR:", err);
  }
};
