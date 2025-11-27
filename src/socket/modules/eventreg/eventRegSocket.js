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
function emitEmailProgress(eventId, payload) {
  emitUpdate("registrationEmailProgress", {
    eventId,
    ...payload,
  });
}

// Emit progressive loading progress with optional batch data
function emitLoadingProgress(eventId, loaded, total, data = null) {
  emitUpdate("registrationLoadingProgress", {
    eventId,
    loaded,
    total,
    ...(data && { data }),
  });
}

// Emit new registration when created
function emitNewRegistration(eventId, registrationData) {
  emitUpdate("registrationNew", {
    eventId,
    registration: registrationData,
  });
}

module.exports = { emitUploadProgress, emitEmailProgress, emitLoadingProgress, emitNewRegistration };
