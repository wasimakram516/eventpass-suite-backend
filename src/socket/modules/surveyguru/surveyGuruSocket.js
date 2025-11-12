const { emitUpdate } = require("../../../utils/socketUtils");

// Emit recipient sync progress (when syncing from event registrations)
function emitSurveySyncProgress(formId, synced, total) {
  emitUpdate("surveySyncProgress", { formId, synced, total });
}

// Emit bulk email sending progress
function emitSurveyEmailProgress(formId, sent, total) {
  emitUpdate("surveyEmailProgress", { formId, sent, total });
}

module.exports = {
  emitSurveySyncProgress,
  emitSurveyEmailProgress,
};
