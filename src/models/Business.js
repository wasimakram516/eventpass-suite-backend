const mongoose = require("mongoose");

const BusinessSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    logoUrl: { type: String },
    owners: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    contact: {
      email: { type: String, match: /.+\@.+\..+/ },
      phone: { type: String },
    },
    address: { type: String },
  },
  { timestamps: true },
);
BusinessSchema.index({ owners: 1, isDeleted: 1 });

// Soft delete plugin
BusinessSchema.plugin(require("../db/plugins/softDelete"));
BusinessSchema.plugin(require("../db/plugins/auditUser"));

// Slug should be unique only among active businesses
BusinessSchema.addPartialUnique({ slug: 1 });

module.exports =
  mongoose.models.Business || mongoose.model("Business", BusinessSchema);
