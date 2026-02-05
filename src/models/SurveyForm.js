const mongoose = require("mongoose");

const OptionSchema = new mongoose.Schema({
  label: { type: String, required: true },
  imageUrl: { type: String, default: null },
}, { _id: true });

const QuestionSchema = new mongoose.Schema({
  label: { type: String, required: true },
  helpText: { type: String, default: "" },
  type: { type: String, enum: ["multi", "text", "rating", "nps"], required: true },
  required: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  options: { type: [OptionSchema], default: [] },
  scale: { min: { type: Number, default: 1 }, max: { type: Number, default: 5 }, step: { type: Number, default: 1 } },
}, { _id: true });

const SurveyFormSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
  slug: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  questions: { type: [QuestionSchema], default: [] },
  isActive: { type: Boolean, default: true },
  isAnonymous: { type: Boolean, default: false },
  defaultLanguage: { type: String, enum: ["en", "ar"], default: "en" },
}, { timestamps: true });

// Unique per business (safer than global uniqueness)
SurveyFormSchema.index({ businessId: 1, slug: 1 }, { unique: true });
SurveyFormSchema.index({ businessId: 1, isDeleted: 1 });

// Soft delete support
SurveyFormSchema.plugin(require("../db/plugins/softDelete"));
SurveyFormSchema.plugin(require("../db/plugins/auditUser"));
// Partial unique index for slug
SurveyFormSchema.addPartialUnique({ slug: 1 });

module.exports = mongoose.models.SurveyForm || mongoose.model("SurveyForm", SurveyFormSchema);
