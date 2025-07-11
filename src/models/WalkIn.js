const mongoose = require("mongoose");

const WalkInSchema = new mongoose.Schema({
  registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration", required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  scannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // staff who scanned QR code
  scannedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.WalkIn || mongoose.model("WalkIn", WalkInSchema);
