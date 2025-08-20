const mongoose = require("mongoose");

const AnswerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    optionIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    text: { type: String, default: null },
    number: { type: Number, default: null },
  },
  { _id: false }
);

const SurveyResponseSchema = new mongoose.Schema(
  {
    formId: { type: mongoose.Schema.Types.ObjectId, ref: "SurveyForm", required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "SurveyRecipient", default: null, index: true },

    attendee: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, trim: true},
      company: { type: String, default: "" },
    },

    answers: { type: [AnswerSchema], default: [] },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

SurveyResponseSchema.index({ formId: 1, "attendee.email": 1 });

// Soft delete support
SurveyResponseSchema.plugin(require("../db/plugins/softDelete"));

module.exports =
  mongoose.models.SurveyResponse ||
  mongoose.model("SurveyResponse", SurveyResponseSchema);
