const mongoose = require("mongoose");

const WallConfigSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  mode: {
    type: String,
    enum: ["mosaic", "card"],
    required: true,
  },
  business: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Business",
    required: true,
  },
}, { timestamps: true });

module.exports = mongoose.models.WallConfig || mongoose.model("WallConfig", WallConfigSchema);
