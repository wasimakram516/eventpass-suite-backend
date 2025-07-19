const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answers: [{ type: String, required: true }],
  correctAnswerIndex: { type: Number, required: true },
  hint: { type: String },
});

const gameSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    coverImage: { type: String, required: true },
    nameImage: { type: String, required: true },
    backgroundImage: { type: String, required: true },
    choicesCount: { type: Number, enum: [2, 3, 4, 5], required: true },
    countdownTimer: { type: Number, default: 3 },
    gameSessionTimer: { type: Number, required: true },
    mode: { type: String, enum: ["solo", "pvp"], required: true },
    questions: [questionSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.models.Game || mongoose.model("Game", gameSchema);