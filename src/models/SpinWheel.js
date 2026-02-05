const mongoose = require("mongoose");

const spinWheelSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    type: {
      type: String,
      enum: ["admin", "onspot", "synced"],
      default: "admin",
      required: true,
    },

    logoUrl: { type: String },
    backgroundUrl: { type: String },
    eventSource: {
      enabled: { type: Boolean, default: false },

      eventId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Event",
        required: function () {
          return this.eventSource?.enabled === true;
        },
      },

      filters: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },

      description: {
        type: String,
      },

      lastSync: {
        at: Date,
        count: Number,
      },
    },
  },
  { timestamps: true }
);

// Soft delete support
spinWheelSchema.plugin(require("../db/plugins/softDelete"));
spinWheelSchema.plugin(require("../db/plugins/auditUser"));
// Partial unique index for slug
spinWheelSchema.addPartialUnique({ slug: 1 });
module.exports =
  mongoose.models.SpinWheel || mongoose.model("SpinWheel", spinWheelSchema);
