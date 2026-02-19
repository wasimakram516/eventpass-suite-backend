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

module.exports = async function loadRemainingRecipients(formId, regs, CHUNK_SIZE = 100, logContext = {}) {
  const total = regs.length;
  let processed = 0;
  const { userId = null } = logContext;

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
      const result = await SurveyRecipient.bulkWrite(bulkOps, { ordered: false });
      const upsertedIds = result.upsertedIds || {};
      const ids = Object.keys(upsertedIds).map((k) => upsertedIds[k]);
      if (ids.length && userId) {
        await SurveyRecipient.updateMany(
          { _id: { $in: ids } },
          { $set: { createdBy: userId } }
        );
      }
    }

    emitSurveySyncProgress(formId, processed, total);

    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  emitSurveySyncProgress(formId, total, total);
}
