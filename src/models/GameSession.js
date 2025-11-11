const mongoose = require("mongoose");

const GameSessionSchema = new mongoose.Schema(
  {
    gameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Game",
      required: true,
    },

    // Individual Mode (1v1 / Solo)
    players: [
      {
        playerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Player",
          required: true,
        },
        playerType: {
          type: String,
          enum: ["p1", "p2", "solo"],
          required: true,
        },
        score: { type: Number, default: 0 },
        timeTaken: { type: Number, default: 0 },
        attemptedQuestions: { type: Number, default: 0 },
      },
    ],

    // Team Mode
    teams: [
      {
        teamId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Team",
          required: true,
        },
        players: [
          {
            playerId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Player",
              required: true,
            },
            score: { type: Number, default: 0 },
            timeTaken: { type: Number, default: 0 },
            attemptedQuestions: { type: Number, default: 0 },
          },
        ],
        totalScore: { type: Number, default: 0 },
        avgTimeTaken: { type: Number, default: 0 },
        avgAttemptedQuestions: { type: Number, default: 0 },
      },
    ],

    questionsAssigned: {
      Player1: [{ type: Number }],
      Player2: [{ type: Number }],
      solo: [{ type: Number }],
      Teams: [
        {
          teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
          questionIndexes: [{ type: Number }],
        },
      ],
    },

    winner: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
    winnerTeamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },

    status: {
      type: String,
      enum: ["pending", "abandoned", "active", "completed"],
      default: "pending",
    },

    startTime: { type: Date },
    endTime: { type: Date },
    memoryStats: {
      moves: { type: Number, default: 0 },
      matches: { type: Number, default: 0 },
      misses: { type: Number, default: 0 },
      totalTime: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Indexes for query performance
GameSessionSchema.index({ status: 1, isDeleted: 1 });
GameSessionSchema.index({ gameId: 1, isDeleted: 1 });
GameSessionSchema.index({ createdAt: 1, isDeleted: 1 });

// Soft delete plugin
GameSessionSchema.plugin(require("../db/plugins/softDelete"));

module.exports =
  mongoose.models.GameSession ||
  mongoose.model("GameSession", GameSessionSchema);
