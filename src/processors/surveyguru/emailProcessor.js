const Registration = require("../../models/Registration");
const SurveyRecipient = require("../../models/SurveyRecipient");
const sendEmail = require("../../services/emailService");
const {
  buildSurveyInvitationEmail,
} = require("../../utils/emailTemplateBuilder/surveyEmailTemplateBuilder");
const {
  emitSurveyEmailProgress,
} = require("../../socket/modules/surveyguru/surveyGuruSocket");

// Process bulk emails in background
module.exports = async function processBulkEmails(
  form,
  event,
  recipients,
  overrides = {}
) {
  const total = recipients.length;
  let processed = 0;
  let sentCount = 0;
  let failedCount = 0;
  const effectiveForm = {
    ...form,
    ...(overrides.emailSubject !== undefined
      ? { emailSubject: overrides.emailSubject }
      : {}),
    ...(overrides.greetingMessage !== undefined
      ? { greetingMessage: overrides.greetingMessage }
      : {}),
  };

  for (const recipient of recipients) {
    processed++;

    try {
      const reg = await Registration.findOne({
        eventId: form.eventId,
        email: recipient.email,
      })
        .select("customFields fullName email phone company")
        .lean();

      // normalize custom fields
      let cf = {};
      if (reg?.customFields) {
        if (Array.isArray(reg.customFields)) {
          cf = Object.fromEntries(reg.customFields);
        } else if (typeof reg.customFields === "object") {
          cf = reg.customFields;
        }
      }

      const displayName =
        recipient.fullName ||
        reg?.fullName ||
        (event.defaultLanguage === "ar" ? "ضيف" : "Guest");

      const { subject, html } = await buildSurveyInvitationEmail({
        event,
        form: effectiveForm,
        recipient,
        registration: {
          ...reg,
          customFields: cf,
        },
        displayName,
      });

      const result = await sendEmail(recipient.email, subject, html);

      if (result.success) {
        // Keep "responded" immutable; otherwise promote queued/notified to notified.
        await SurveyRecipient.updateOne(
          { _id: recipient._id, status: { $ne: "responded" } },
          {
            $set: {
              status: "notified",
              notificationSent: true,
              notificationSentAt: new Date(),
            },
          }
        );
        sentCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      failedCount++;
    }

    // Send progress
    emitSurveyEmailProgress(form._id.toString(), {
      sent: sentCount,
      failed: failedCount,
      processed,
      total,
    });

    // Allow event loop breathing
    await new Promise((r) => setTimeout(r, 20));
  }

  // Final 100%
  emitSurveyEmailProgress(form._id.toString(), {
    sent: sentCount,
    failed: failedCount,
    processed: total,
    total,
  });

  console.log(
    `Bulk email job completed: ${sentCount} sent, ${failedCount} failed, out of ${total}`
  );
};
