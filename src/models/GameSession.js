const mongoose = require("mongoose");

const GameSessionSchema = new mongoose.Schema({
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: "Game", required: true },

  players: [
    {
      playerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
      playerType: { type: String, enum: ["p1", "p2", "solo"], required: true },
      score: { type: Number, default: 0 },
      timeTaken: { type: Number, default: 0 },
      attemptedQuestions: { type: Number, default: 0 },
    }
  ],

  questionsAssigned: {
    Player1: [{ type: Number }], // indexes of assigned questions
    Player2: [{ type: Number }],
    solo: [{ type: Number }],
  },

  winner: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
  status: { type: String, enum: ["pending", "abandoned", "active", "completed"], default: "pending" },
  startTime: { type: Date },
  endTime: { type: Date },

}, { timestamps: true });

// Soft delete support
GameSessionSchema.plugin(require("../db/plugins/softDelete"));

module.exports = mongoose.models.GameSession || mongoose.model("GameSession", GameSessionSchema);
