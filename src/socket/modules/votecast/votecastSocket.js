const { emitUpdate } = require("../../../utils/socketUtils");

function emitVoteCast(pollId, isNewVoter, questionCount) {
  emitUpdate("pollVoteCast", { pollId, isNewVoter, questionCount });
}

function emitPollQuestionCountChanged(pollId, questionCount) {
  emitUpdate("pollQuestionCountChanged", { pollId, questionCount });
}

module.exports = { emitVoteCast, emitPollQuestionCountChanged };
