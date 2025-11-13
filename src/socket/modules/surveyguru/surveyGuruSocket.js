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
function emitSurveyEmailProgress(formId, sent, total) {
  emitUpdate("surveyEmailProgress", { formId, sent, total });
}

module.exports = {
  emitSurveySyncProgress,
  emitSurveyEmailProgress,
};
