const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  company: { type: String },
}, { timestamps: true });

// Soft delete support
playerSchema.plugin(require("../db/plugins/softDelete"));

module.exports = mongoose.models.Player || mongoose.model("Player", playerSchema);
