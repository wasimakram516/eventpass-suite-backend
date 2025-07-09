const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true }, 
  date: { type: Date, required: true },
  venue: { type: String, required: true },
  description: { type: String },
  logoUrl: { type: String },
  capacity: { type: Number, default: 999 },
  registrations: { type: Number, default: 0 },
  eventType: {
    type: String,
    enum: ["employee", "public"],
    required: true,
    default: "public",
  },
  employeeData: [
    {
      employeeId: { type: String, required: true },
      employeeName: { type: String },
      tableNumber: { type: String, required: true },
      tableImage: { type: String, required: true },
    },
  ],
});

module.exports = mongoose.model("Event", EventSchema);
