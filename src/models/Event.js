const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true },
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
  brandingMediaUrl: { type: String },
  agendaUrl: { type: String },
  capacity: { type: Number, default: 999 },
  showQrAfterRegistration: { type: Boolean, default: false },
  registrations: { type: Number, default: 0 },
  eventType: {
    type: String,
    enum: ["employee", "public"],
    required: true,
    default: "public",
  },

  /** ===== Custom Form Fields ===== */
  formFields: [
    {
      inputName: { type: String, required: true },
      inputType: {
        type: String,
        enum: ["text", "number", "radio", "list"],
        required: true,
      },
      values: [String], 
      required: { type: Boolean, default: false },
      visible: { type: Boolean, default: true }, 
    },
  ],

  /** ===== Employee Data (for employee events) ===== */
  employeeData: [
    {
      employeeId: { type: String, required: true },
      employeeName: { type: String },
      tableNumber: { type: String, required: true },
      tableImage: { type: String, required: true },
    },
  ],
});

EventSchema.index({ businessId: 1, isDeleted: 1 });
EventSchema.index({ eventType: 1, startDate: 1, isDeleted: 1 });
EventSchema.index({ createdAt: 1, isDeleted: 1 });

// Soft delete support
EventSchema.plugin(require("../db/plugins/softDelete"));
// Partial unique index for slug
EventSchema.addPartialUnique({ slug: 1 });

module.exports = mongoose.models.Event || mongoose.model("Event", EventSchema);
