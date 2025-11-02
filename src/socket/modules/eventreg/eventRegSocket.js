const { emitUpdate } = require("../../../utils/socketUtils");

// Emit upload progress for registrations
function emitUploadProgress(eventId, uploaded, total) {
  emitUpdate("registrationUploadProgress", {
    eventId,
    uploaded,
    total,
  });
}

// Emit email sending progress for registrations
function emitEmailProgress(eventId, sent, total) {
  emitUpdate("registrationEmailProgress", { eventId, sent, total });
}

module.exports = { emitUploadProgress, emitEmailProgress };
