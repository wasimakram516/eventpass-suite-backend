const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String },
  company: { type: String },
  spinWheel: { type: mongoose.Schema.Types.ObjectId, ref: "SpinWheel", required: true },
}, { timestamps: true });

// Soft delete support
participantSchema.plugin(require("../db/plugins/softDelete"));
module.exports = mongoose.models.SpinWheelParticipant || mongoose.model("SpinWheelParticipant", participantSchema);
