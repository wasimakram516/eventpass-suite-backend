const mongoose = require("mongoose");

const MetricsSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["superadmin", "business"],
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      default: null, // only for scope = business
    },

    modules: {
      quiznest: {
        totals: {
          games: { type: Number, default: 0 },
          players: { type: Number, default: 0 },
        },
        trash: {
          games: { type: Number, default: 0 },
          players: { type: Number, default: 0 },
        },
      },
      eventduel: {
        totals: {
          games: { type: Number, default: 0 },
          sessions: { type: Number, default: 0 },
        },
        trash: {
          games: { type: Number, default: 0 },
          sessions: { type: Number, default: 0 },
        },
      },
      eventreg: {
        totals: {
          events: { type: Number, default: 0 },
          registrations: { type: Number, default: 0 },
          walkins: { type: Number, default: 0 },
        },
        trash: {
          events: { type: Number, default: 0 },
          registrations: { type: Number, default: 0 },
          walkins: { type: Number, default: 0 },
        },
      },
      checkin: {
        totals: {
          events: { type: Number, default: 0 },
          registrations: { type: Number, default: 0 },
          walkins: { type: Number, default: 0 },
        },
        trash: {
          events: { type: Number, default: 0 },
          registrations: { type: Number, default: 0 },
          walkins: { type: Number, default: 0 },
        },
      },
      stageq: {
        totals: {
          answered: { type: Number, default: 0 },
          unanswered: { type: Number, default: 0 },
          visitors: { type: Number, default: 0 },
          repeatVisitors: { type: Number, default: 0 },
        },
        trash: {
          questions: { type: Number, default: 0 },
          visitors: { type: Number, default: 0 },
        },
      },
      mosaicwall: {
        totals: {
          configs: { type: Number, default: 0 },
          media: { type: Number, default: 0 },
        },
        trash: {
          configs: { type: Number, default: 0 },
          media: { type: Number, default: 0 },
        },
      },
      eventwheel: {
        totals: {
          wheels: { type: Number, default: 0 },
          participants: { type: Number, default: 0 },
        },
        trash: {
          wheels: { type: Number, default: 0 },
          participants: { type: Number, default: 0 },
        },
      },
      surveyguru: {
        totals: {
          forms: { type: Number, default: 0 },
          responses: { type: Number, default: 0 },
          recipients: { type: Number, default: 0 },
        },
        trash: {
          forms: { type: Number, default: 0 },
          responses: { type: Number, default: 0 },
          recipients: { type: Number, default: 0 },
        },
      },
      votecast: {
        totals: {
          polls: { type: Number, default: 0 },
        },
        trash: {
          polls: { type: Number, default: 0 },
        },
      },
      global: {
        totals: {
          businesses: { type: Number, default: 0 },
          users: {
            admin: { type: Number, default: 0 },
            business: { type: Number, default: 0 },
            staff: { type: Number, default: 0 },
          },
        },
        trash: {
          businesses: { type: Number, default: 0 },
          users: {
            admin: { type: Number, default: 0 },
            business: { type: Number, default: 0 },
            staff: { type: Number, default: 0 },
          },
        },
      },
    },

    // last recalculation timestamp
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Unique per business or superadmin
MetricsSchema.index({ scope: 1, businessId: 1 }, { unique: true });

module.exports =
  mongoose.models.Metrics || mongoose.model("Metrics", MetricsSchema);
