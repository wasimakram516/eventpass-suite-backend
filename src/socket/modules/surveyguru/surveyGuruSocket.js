const { emitUpdate } = require("../../../utils/socketUtils");

// Emit sync progress and recipient info
function emitSurveySyncProgress(formId, synced, total) {
  emitUpdate("surveySyncProgress", {
    formId,
    synced,
    total,
  });
}

// Emit bulk email progress
function emitSurveyEmailProgress(formId, data) {
  emitUpdate("surveyEmailProgress", {
    formId,
    ...data,
  });
}

// Emit recipient status changes (e.g. responded)
function emitSurveyRecipientStatus(formId, data) {
  emitUpdate("surveyRecipientStatus", {
    formId,
    ...data,
  });
}

module.exports = {
  emitSurveySyncProgress,
  emitSurveyEmailProgress,
  emitSurveyRecipientStatus,
};
