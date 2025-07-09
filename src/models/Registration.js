const mongoose = require("mongoose");

const RegistrationSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
  employeeId: { type: String, default: null }, // Used if eventType is 'employee'
  fullName: { type: String, default: null },  // Used if eventType is 'public'
  email: { type: String, default: null },
  phone: { type: String, default: null },
  company: { type: String, default: null },
});

module.exports = mongoose.model("Registration", RegistrationSchema);
