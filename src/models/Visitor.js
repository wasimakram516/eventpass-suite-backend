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
VisitorSchema.index({ isDeleted: 1 });
VisitorSchema.index({ "eventHistory.business": 1, isDeleted: 1 });

// Soft delete support
VisitorSchema.plugin(require("../db/plugins/softDelete"));
VisitorSchema.plugin(require("../db/plugins/auditUser"));

module.exports = mongoose.models.Visitor || mongoose.model("Visitor", VisitorSchema);
