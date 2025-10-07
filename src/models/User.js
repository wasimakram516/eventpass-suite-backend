const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MODULES } = require("../constants/modules");
const softDelete = require("../db/plugins/softDelete");

const VALID_MODULE_KEYS = MODULES.map((m) => m.key);

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, required: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ["admin", "business", "staff"],
      default: "business",
    },
    
    staffType: {
      type: String,
      enum: ["door", "desk"],
      default: null,
    },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null,
    },

    modulePermissions: [
      {
        type: String,
        enum: VALID_MODULE_KEYS,
      },
    ],
  },
  { timestamps: true }
);

// Soft delete support
userSchema.plugin(softDelete);

// Partial unique index for email
userSchema.addPartialUnique({ email: 1 });

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Enforce staffType only for staff users
userSchema.pre("save", function (next) {
  if (this.role !== "staff") {
    this.staffType = null; // reset if not staff
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
