const mongoose = require('mongoose');

const spinWheelSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true },
    title: { type: String, required: true },
    slug: { type: String, unique: true, required: true },
    type: { type: String, enum: ["collect_info", "enter_names"], required: true },
    logoUrl: { type: String }, 
    backgroundUrl: { type: String }, 
  },
  { timestamps: true }
);

module.exports = mongoose.models.SpinWheel || mongoose.model("SpinWheel", spinWheelSchema);

