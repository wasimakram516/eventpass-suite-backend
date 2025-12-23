const { emitUpdate } = require("../../../utils/socketUtils");

function emitSpinWheelSync(spinWheelId, payload) {
  emitUpdate("spinWheelSync", {
    spinWheelId,
    ...payload,
  });
}

module.exports = {
  emitSpinWheelSync,
};
