const mongoose = require("mongoose");
let nanoid;
(async () => {
  const { nanoid: _nanoid } = await import("nanoid");
  nanoid = _nanoid;
})();

const RegistrationSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    employeeId: { type: String, default: null }, // For employee events

    fullName: { type: String, default: null }, // Fallback for public events if custom fields are not provided
    email: { type: String, default: null },
    phone: { type: String, default: null },
    company: { type: String, default: null },

    customFields: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    emailSent: { type: Boolean, default: false },
    token: { type: String, required: true }, // For QR
  },
  { timestamps: true }
);

RegistrationSchema.pre("validate", async function (next) {
  try {
    // If no token was provided → always create one
    if (!this.token) {
      this.token = nanoid(10);
      return next();
    }

    // Global uniqueness check for provided token
    const existing = await mongoose.models.Registration.findOne({
      token: this.token,
      _id: { $ne: this._id },
    });

    if (existing) {
      // Collision: replace with auto-generated token
      this.token = nanoid(10);
    }

    next();
  } catch (err) {
    next(err);
  }
});


RegistrationSchema.index({ eventId: 1, isDeleted: 1 });

// Soft delete support
RegistrationSchema.plugin(require("../db/plugins/softDelete"));

// Partial unique index for eventId and token
RegistrationSchema.addPartialUnique({ eventId: 1, token: 1 });

module.exports =
  mongoose.models.Registration ||
  mongoose.model("Registration", RegistrationSchema);
