const mongoose = require('mongoose');

const spinWheelSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    type: { type: String, enum: ["collect_info", "enter_names"], required: true },
    logoUrl: { type: String }, 
    backgroundUrl: { type: String }, 
  },
  { timestamps: true }
);

// Soft delete support
spinWheelSchema.plugin(require("../db/plugins/softDelete"));
// Partial unique index for slug
spinWheelSchema.addPartialUnique({ slug: 1 });
module.exports = mongoose.models.SpinWheel || mongoose.model("SpinWheel", spinWheelSchema);

