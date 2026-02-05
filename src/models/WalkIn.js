const mongoose = require("mongoose");

const WalkInSchema = new mongoose.Schema({
  registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration", required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  scannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // staff who scanned QR code
  scannedAt: { type: Date, default: Date.now }
}, { timestamps: true });
WalkInSchema.index({ eventId: 1, isDeleted: 1, scannedAt: -1 });

// Soft delete support
WalkInSchema.plugin(require("../db/plugins/softDelete"));
WalkInSchema.plugin(require("../db/plugins/auditUser"));

module.exports = mongoose.models.WalkIn || mongoose.model("WalkIn", WalkInSchema);
