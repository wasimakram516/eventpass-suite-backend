const mongoose = require("mongoose");
let nanoid;
(async () => {
  const { nanoid: _nanoid } = await import('nanoid');
  nanoid = _nanoid;
})();

const RegistrationSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },

  employeeId: { type: String, default: null }, // Used if eventType is 'employee'
  fullName: { type: String, default: null },   // Used if eventType is 'public'
  email: { type: String, default: null },
  phone: { type: String, default: null },
  company: { type: String, default: null },

  // For QR tracking and verification
  token: { type: String, required: true, unique: true }, // Unique ID used in QR code

}, {
  timestamps: true
});

RegistrationSchema.pre('validate', function (next) {
  if (!this.token) {
    this.token = nanoid(10); 
  }
  next();
});

module.exports = mongoose.models.Registration || mongoose.model("Registration", RegistrationSchema);
