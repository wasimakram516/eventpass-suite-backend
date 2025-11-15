const SurveyForm = require("../../models/SurveyForm");
const SurveyRecipient = require("../../models/SurveyRecipient");
const {
  emitSurveySyncProgress,
} = require("../../socket/modules/surveyguru/surveyGuruSocket");
const {
  pickEmail,
  pickFullName,
  pickCompany,
} = require("../../utils/customFieldUtils");

// Utility to sync recipients in chunks
module.exports = async function loadRemainingRecipients(formId, regs, CHUNK_SIZE = 100) {
  const total = regs.length;
  let processed = 0;

  const form = await SurveyForm.findById(formId).lean();
  if (!form) return console.error("Sync stopped — form not found", formId);

  for (let i = 0; i < regs.length; i += CHUNK_SIZE) {
    const chunk = regs.slice(i, i + CHUNK_SIZE);
    const bulkOps = [];

    for (const reg of chunk) {
      processed++;

      const email = (pickEmail(reg.customFields) || reg.email || "")
        .trim()
        .toLowerCase();

      if (!email) continue;

      const fullName = pickFullName(reg.customFields) || reg.fullName || "";

      const company = pickCompany(reg.customFields) || reg.company || "";

      const token = reg.token || "";

      bulkOps.push({
        updateOne: {
          filter: { formId, email },
          update: {
            $setOnInsert: {
              formId,
              businessId: form.businessId,
              eventId: form.eventId,
              email,
              status: "queued",
            },
            $set: { fullName, company, token },
          },
          upsert: true,
          collation: { locale: "en", strength: 2 },
        },
      });
    }

    if (bulkOps.length) {
      await SurveyRecipient.bulkWrite(bulkOps, { ordered: false });
    }

    // Emit only progress — lightweight
    emitSurveySyncProgress(formId, processed, total);

    // avoid event loop blocking
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  // Final 100%
  emitSurveySyncProgress(formId, total, total);
}
