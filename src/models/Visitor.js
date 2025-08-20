const mongoose = require('mongoose');

const VisitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String },
    company: { type: String },

    eventHistory: [
      {
        business: { type: mongoose.Schema.Types.ObjectId, ref: "Business" },
        count: { type: Number, default: 1 },
        lastInteraction: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Soft delete support
VisitorSchema.plugin(require("../db/plugins/softDelete"));
// Partial unique index for phone
VisitorSchema.addPartialUnique({ phone: 1 });

module.exports = mongoose.models.Visitor || mongoose.model("Visitor", VisitorSchema);
