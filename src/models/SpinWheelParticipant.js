const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String },
  isoCode: { type: String, default: "om" }, // ISO country code (e.g., "om", "pk") for phone number
  company: { type: String },
  visible: { type: Boolean, default: true },
  spinWheel: { type: mongoose.Schema.Types.ObjectId, ref: "SpinWheel", required: true },
}, { timestamps: true });

// Soft delete support
participantSchema.plugin(require("../db/plugins/softDelete"));
participantSchema.plugin(require("../db/plugins/auditUser"));
module.exports = mongoose.models.SpinWheelParticipant || mongoose.model("SpinWheelParticipant", participantSchema);
