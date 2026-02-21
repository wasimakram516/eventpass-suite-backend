const mongoose = require("mongoose");

const SurveyRecipientSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    formId: { type: mongoose.Schema.Types.ObjectId, ref: "SurveyForm", required: true, index: true },

    email: { type: String, required: true, trim: true, lowercase: true },
    fullName: { type: String, default: null },
    company: { type: String, default: null },

    token: { type: String, required: true, index: true }, // used in public link ?token=

    status: {
      type: String,
      enum: ["queued", "notified", "responded"],
      default: "queued",
      index: true,
    },
    notificationSent: { type: Boolean, default: false, index: true },
    notificationSentAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// prevent duplicates per form (case-insensitive on email)
SurveyRecipientSchema.index(
  { formId: 1, email: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
SurveyRecipientSchema.index({ businessId: 1, status: 1, createdAt: 1 });
SurveyRecipientSchema.plugin(require("../db/plugins/auditUser"));

module.exports =
  mongoose.models.SurveyRecipient ||
  mongoose.model("SurveyRecipient", SurveyRecipientSchema);
