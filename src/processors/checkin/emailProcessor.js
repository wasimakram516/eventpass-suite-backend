const Registration = require("../../models/Registration");
const { buildCheckInInvitationEmail } = require("../../utils/checkinEmailTemplateBuilder");
const sendEmail = require("../../services/emailService");

const {
  pickEmail,
  pickFullName,
  pickCompany,
} = require("../../utils/customFieldUtils");

const {
  emitEmailProgress,
} = require("../../socket/modules/checkin/checkInSocket");

module.exports = async function emailProcessor(event, recipients, customEmail = null) {
  const eventId = event._id.toString();
  const total = recipients.length;

  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    // Handle case when there are no recipients
    if (total === 0) {
      emitEmailProgress(eventId, {
        sent: 0,
        failed: 0,
        processed: 0,
        total: 0,
      });
      console.log(
        `CheckIn bulk email finished: 0 sent, 0 failed, total 0`
      );
      return;
    }

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

        const { subject, html } = await buildCheckInInvitationEmail({
          event,
          registration: {
            ...reg,
            customFields: cf,
            fullName,
            email,
            company,
            token: reg.token,
          },
          customSubject: customEmail?.subject || null,
          customBody: customEmail?.body || null,
          displayName,
          isReminder,
        });

        const result = await sendEmail(email, subject, html);

        if (result.success) {
          await Registration.updateOne({ _id: r._id }, { emailSent: true });
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
      `CheckIn bulk email finished: ${sent} sent, ${failed} failed, total ${total}`
    );
  } catch (err) {
    console.error("CHECKIN EMAIL PROCESSOR ERROR:", err);
  }
};

