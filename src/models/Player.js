const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    company: { type: String },
    phone: { type: String, trim: true },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GameSession",
    },
  },
  { timestamps: true }
);

playerSchema.index({ name: 1 });
playerSchema.index({ company: 1 });

// Soft delete support
playerSchema.plugin(require("../db/plugins/softDelete"));

module.exports =
  mongoose.models.Player || mongoose.model("Player", playerSchema);
