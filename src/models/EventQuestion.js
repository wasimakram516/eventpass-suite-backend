const mongoose = require('mongoose');

const EventQuestionSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    text: { type: String, required: true },
    votes: { type: Number, default: 0 },
    answered: { type: Boolean, default: false },
    visitor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visitor",
      default: null,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StageQSession",
      default: null,
    },
    registrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      default: null,
    },
  },
  { timestamps: true }
);

// Soft delete support
EventQuestionSchema.plugin(require("../db/plugins/softDelete"));
EventQuestionSchema.plugin(require("../db/plugins/auditUser"));

module.exports = mongoose.models.EventQuestion ||
  mongoose.model("EventQuestion", EventQuestionSchema);
