const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MODULES } = require("../constants/modules");

const VALID_MODULE_KEYS = MODULES.map((m) => m.key);

const userSchema = new mongoose.Schema(
  {
    name: { type: String },

    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ["admin", "business", "staff"],
      default: "business",
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

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method for password comparison
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
