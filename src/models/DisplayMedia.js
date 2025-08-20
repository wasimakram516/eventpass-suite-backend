const mongoose = require("mongoose");

const DisplayMediaSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true
  },
  text: {
    type: String,
    default: ""
  },
  wall: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "WallConfig",
    required: true
  }
}, { timestamps: true });

// Soft delete support
DisplayMediaSchema.plugin(require("../db/plugins/softDelete"));

module.exports = mongoose.models.DisplayMedia || mongoose.model("DisplayMedia", DisplayMediaSchema);
