const mongoose = require("mongoose");

const PollVoteSchema = new mongoose.Schema({
  pollId: { type: mongoose.Schema.Types.ObjectId, ref: "Poll", required: true },
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration" },
  sessionToken: { type: String, default: null },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  optionIndex: { type: Number, required: true },
  votedAt: { type: Date, default: Date.now },
});

// One vote per registrant per question (linked polls only)
PollVoteSchema.index(
  { pollId: 1, questionId: 1, registrationId: 1 },
  { unique: true, partialFilterExpression: { registrationId: { $exists: true, $ne: null } } }
);
// One vote per session per question (anonymous/unlinked polls only)
PollVoteSchema.index(
  { pollId: 1, questionId: 1, sessionToken: 1 },
  { unique: true, partialFilterExpression: { sessionToken: { $exists: true, $ne: null } } }
);
PollVoteSchema.index({ pollId: 1 });
PollVoteSchema.index({ votedAt: 1 });

module.exports = mongoose.models.PollVote || mongoose.model("PollVote", PollVoteSchema);
