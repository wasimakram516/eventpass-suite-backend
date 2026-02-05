const mongoose = require("mongoose");

const fileResourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    fileKey: { type: String, required: true },
    fileUrl: { type: String, required: true },
    contentType: { type: String }, // e.g. application/pdf
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
  },
  { timestamps: true }
);

fileResourceSchema.plugin(require("../db/plugins/auditUser"));

module.exports =
  mongoose.models.FileResource ||
  mongoose.model("FileResource", fileResourceSchema);
