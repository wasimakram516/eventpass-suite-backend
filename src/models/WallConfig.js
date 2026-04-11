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
    mosaicGrid: {
      rows: {
        type: Number,
        default: 10,
      },
      cols: {
        type: Number,
        default: 15,
      },
    },
    cardSettings: {
      order: {
        type: String,
        enum: ["sequential", "random"],
        default: "sequential",
      },
      backgroundColor: {
        type: String,
        default: "#ffffff",
      },
      randomColors: {
        type: Boolean,
        default: false,
      },
      imageShape: {
        type: String,
        enum: ["circle", "top-70", "full"],
        default: "circle",
      },
      mediaType: {
        type: String,
        enum: ["type1", "type2"],
        default: "type1",
      },
      mediaType2TextColor: {
        type: String,
        default: "#000000",
      },
      mediaType2SignatureColor: {
        type: String,
        default: "#000000",
      },
    },
    background: {
      key: { type: String },
      url: { type: String },
    },
    backgroundLogo: {
      key: { type: String },
      url: { type: String },
      overlayEnabled: { type: Boolean, default: false },
      opacity: { type: Number, default: 100 },
      stampOnImages: { type: Boolean, default: false },
      stampPosition: {
        type: String,
        enum: ["top-left", "top-right", "bottom-left", "bottom-right"],
        default: "bottom-right",
      },
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
