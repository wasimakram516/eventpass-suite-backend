const { emitUpdate } = require("../../../utils/socketUtils");

function emitSpinWheelSync(spinWheelId, payload) {
  emitUpdate("spinWheelSync", {
    spinWheelId,
    ...payload,
  });
}

// Emit upload progress for participants
function emitUploadProgress(spinWheelId, uploaded, total) {
  emitUpdate("spinWheelUploadProgress", {
    spinWheelId,
    uploaded,
    total,
  });
}

module.exports = {
  emitSpinWheelSync,
  emitUploadProgress,
};
