const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Business",
    required: true,
  },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function (value) {
        return value >= this.startDate;
      },
      message: "End date must be greater than or equal to start date.",
    },
  },
  venue: { type: String, required: true },
  description: { type: String },
  logoUrl: { type: String },
  background: {
    en: {
      key: { type: String },
      url: { type: String },
      fileType: { type: String, enum: ["image", "video"] },
    },
    ar: {
      key: { type: String },
      url: { type: String },
      fileType: { type: String, enum: ["image", "video"] },
    },
  },
  brandingMedia: [
    {
      name: { type: String },
      logoUrl: { type: String },
      website: { type: String },
    },
  ],
  agendaUrl: { type: String },
  capacity: { type: Number, default: 999 },
  showQrAfterRegistration: { type: Boolean, default: false },
  showQrOnBadge: { type: Boolean, default: true },
  requiresApproval: { type: Boolean, default: false },
  useInternationalNumbers: { type: Boolean, default: false },
  defaultLanguage: {
    type: String,
    enum: ["en", "ar"],
    default: "en"
  },
  organizerName: { type: String },
  organizerEmail: { type: String },
  organizerPhone: { type: String },
  registrations: { type: Number, default: 0 },
  eventType: {
    type: String,
    enum: ["closed", "public"],
    required: true,
    default: "public",
  },
  startTime: { type: String },
  endTime: { type: String },
  timezone: { type: String, default: "Asia/Muscat" },

  /** ===== Custom Form Fields ===== */
  formFields: [
    {
      inputName: { type: String, required: true },
      inputType: {
        type: String,
        enum: ["text", "number", "phone", "radio", "list", "email"],
        required: true,
      },
      values: [String],
      required: { type: Boolean, default: false },
      visible: { type: Boolean, default: true },
    },
  ],

  /** ===== Custom Email Template ===== */
  useCustomEmailTemplate: { type: Boolean, default: false },
  emailTemplate: {
    subject: { type: String },
    body: { type: String },
  },

  /** ===== Badge Customizations ===== */
  customizations: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
});

EventSchema.index({ businessId: 1, isDeleted: 1 });
EventSchema.index({ eventType: 1, startDate: 1, isDeleted: 1 });
EventSchema.index({ createdAt: 1, isDeleted: 1 });

// Soft delete support
EventSchema.plugin(require("../db/plugins/softDelete"));
// Partial unique index for slug
EventSchema.addPartialUnique({ slug: 1 });

module.exports = mongoose.models.Event || mongoose.model("Event", EventSchema);
