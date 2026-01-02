const Registration = require("../../models/Registration");
const sendEmail = require("../../services/emailService");

const {
  buildCustomEmail,
} = require("../../utils/emailTemplateBuilder/buildCustomEmail");
const {
  buildCheckInInvitationEmail,
} = require("../../utils/emailTemplateBuilder/checkinEmailTemplateBuilder");
const {
  pickEmail,
  pickFullName,
  pickCompany,
} = require("../../utils/customFieldUtils");

const {
  emitEmailProgress,
} = require("../../socket/modules/checkin/checkInSocket");

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

  if (!total) {
    emitEmailProgress(eventId, { sent: 0, failed: 0, processed: 0, total: 0 });
    return;
  }

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
        ({ subject, html, qrCodeDataUrl } = buildCustomEmail({
          event,
          subject: customEmail.subject,
          bodyHtml: customEmail.body,
        }));
      } else {
        ({ subject, html, qrCodeDataUrl } = await buildCheckInInvitationEmail({
          event,
          registration: {
            ...reg,
            customFields: cf,
            fullName,
            email,
            company,
            token: reg.token,
          },
          displayName,
          isReminder,
        }));
      }

      const attachments = [];
      if (event.agendaUrl) {
        attachments.push({ filename: "Agenda.pdf", path: event.agendaUrl });
      }
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
        await Registration.updateOne({ _id: r._id }, { emailSent: true });
        sent++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error("Email send error:", err);
      failed++;
    }

    emitEmailProgress(eventId, { sent, failed, processed, total });
    await new Promise((r) => setTimeout(r, 20));
  }

  emitEmailProgress(eventId, {
    sent,
    failed,
    processed: total,
    total,
  });
};
