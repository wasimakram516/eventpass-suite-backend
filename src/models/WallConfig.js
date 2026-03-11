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
      enum: ["mosaic", "card", "bubble"],
      required: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    randomSizes: {
      enabled: {
        type: Boolean,
        default: false,
      },
      min: {
        type: Number,
        default: 150,
      },
      max: {
        type: Number,
        default: 300,
      },
    },
    background: {
      key: { type: String },
      url: { type: String },
    },
    backgroundLogo: {
      key: { type: String },
      url: { type: String },
    },
  },
  { timestamps: true },
);

WallConfigSchema.index({ business: 1, isDeleted: 1 });

// Soft delete support
WallConfigSchema.plugin(require("../db/plugins/softDelete"));
WallConfigSchema.plugin(require("../db/plugins/auditUser"));
// Partial unique index for slug
WallConfigSchema.addPartialUnique({ slug: 1 });

module.exports = mongoose.models.WallConfig || mongoose.model("WallConfig", WallConfigSchema);
