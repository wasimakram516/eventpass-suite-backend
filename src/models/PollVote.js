const mongoose = require("mongoose");

const PollVoteSchema = new mongoose.Schema({
  pollId: { type: mongoose.Schema.Types.ObjectId, ref: "Poll", required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration" },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  optionIndex: { type: Number, required: true },
  votedAt: { type: Date, default: Date.now },
});

// One vote per registrant per poll question
PollVoteSchema.index({ pollId: 1, questionId: 1, registrationId: 1 }, { unique: true, sparse: true });
PollVoteSchema.index({ pollId: 1 });
PollVoteSchema.index({ votedAt: 1 });

module.exports = mongoose.models.PollVote || mongoose.model("PollVote", PollVoteSchema);
