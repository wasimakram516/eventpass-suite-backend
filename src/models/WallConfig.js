const mongoose = require("mongoose");

const WallConfigSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
    required: true,
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

// Soft delete support
WallConfigSchema.plugin(require("../db/plugins/softDelete"));
// Partial unique index for slug
WallConfigSchema.addPartialUnique({ slug: 1 });

module.exports = mongoose.models.WallConfig || mongoose.model("WallConfig", WallConfigSchema);
