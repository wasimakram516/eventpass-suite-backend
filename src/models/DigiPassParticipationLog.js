const mongoose = require("mongoose");

const DigiPassParticipationLogSchema = new mongoose.Schema({
  digipassEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true,
  },
  eventRegRegistrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Registration",
    required: true,
  },
}, { timestamps: true });

// One log per registrant per digipass event
DigiPassParticipationLogSchema.index({ digipassEventId: 1, eventRegRegistrationId: 1 }, { unique: true });
DigiPassParticipationLogSchema.index({ digipassEventId: 1 });

module.exports = mongoose.models.DigiPassParticipationLog || mongoose.model("DigiPassParticipationLog", DigiPassParticipationLogSchema);
