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

// Emit badge print update
function emitBadgePrinted(eventId, registrationId, printCount, printTimestamp) {
  emitUpdate("registrationBadgePrinted", {
    eventId,
    registrationId,
    printCount,
    printTimestamp,
  });
}

// Emit when a walkin (scan) is recorded for a registration
function emitWalkinCreated(eventId, registrationId) {
  emitUpdate("registrationWalkinCreated", { eventId, registrationId });
}

module.exports = { emitUploadProgress, emitEmailProgress, emitLoadingProgress, emitNewRegistration, emitBadgePrinted, emitWalkinCreated };
