const { emitUpdate } = require("../../../utils/socketUtils");

/* ===========================
   OUTBOUND STATUS UPDATES
=========================== */

function emitWhatsAppStatusUpdate(eventId, payload) {
  emitUpdate("whatsappStatusUpdate", {
    eventId,
    ...payload,
  });
}

/* ===========================
   INBOUND MESSAGE RECEIVED
=========================== */

function emitWhatsAppInboundMessage(eventId, payload) {
  emitUpdate("whatsappInboundMessage", {
    eventId,
    ...payload,
  });
}

module.exports = {
  emitWhatsAppStatusUpdate,
  emitWhatsAppInboundMessage,
};
