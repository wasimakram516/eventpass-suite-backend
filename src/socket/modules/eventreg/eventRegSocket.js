const { emitUpdate } = require("../../../utils/socketUtils");

/**
 * Emit registration upload progress
 * @param {string} eventId - ID of the event
 * @param {number} uploaded - how many processed so far
 * @param {number} total - total rows to upload
 */
function emitUploadProgress(eventId, uploaded, total) {
  emitUpdate("registrationUploadProgress", {
    eventId,
    uploaded,
    total,
  });
}


module.exports = { emitUploadProgress };
