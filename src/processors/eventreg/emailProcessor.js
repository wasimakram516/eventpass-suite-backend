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

        const { subject, html, qrCodeDataUrl } = await buildRegistrationEmail({
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

        const result = await sendEmail(email, subject, html, qrCodeDataUrl);

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

    console.log(
      `Bulk email finished: ${sent} sent, ${failed} failed, total ${total}`
    );
  } catch (err) {
    console.error("EMAIL PROCESSOR ERROR:", err);
  }
};
