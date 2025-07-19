const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  company: { type: String },
}, { timestamps: true });

module.exports = mongoose.models.Player || mongoose.model("Player", playerSchema);
