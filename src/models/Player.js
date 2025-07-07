const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    gameId: { type: mongoose.Schema.Types.ObjectId, ref: "Game", required: true },
    name: { type: String, required: true },
    company: { type: String },
    score: { type: Number, default: 0 },
    timeTaken: { type: Number, default: 0 },
    attemptedQuestions: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["joined", "played"],
      default: "joined",
    }    
  },
  { timestamps: true }
);

module.exports = mongoose.models.Player || mongoose.model("Player", playerSchema);
