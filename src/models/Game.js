const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answers: [{ type: String, required: true }],
    correctAnswerIndex: { type: Number, required: true },
    hint: { type: String },
  },
  { timestamps: true }
);

const gameSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    coverImage: { type: String, required: true },
    nameImage: { type: String, required: true },
    backgroundImage: { type: String, required: true },
    choicesCount: { type: Number, enum: [2, 3, 4, 5], required: true },
    countdownTimer: { type: Number, default: 3 },
    gameSessionTimer: { type: Number, required: true },
    mode: { type: String, enum: ["solo", "pvp"], required: true },
    questions: [questionSchema],

    isTeamMode: { type: Boolean, default: false }, 
    maxTeams: { type: Number, default: 2 }, 
    playersPerTeam: { type: Number, default: 2 }, 
    teams: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Team",
      },
    ],
  },
  { timestamps: true }
);

// Indexes
gameSchema.index({ businessId: 1, mode: 1, isDeleted: 1 });
gameSchema.index({ createdAt: 1, isDeleted: 1 });

// Soft delete plugins
questionSchema.plugin(require("../db/plugins/softDelete"));
gameSchema.plugin(require("../db/plugins/softDelete"));

// Partial unique index for slug
gameSchema.addPartialUnique({ slug: 1 });

module.exports = mongoose.models.Game || mongoose.model("Game", gameSchema);
