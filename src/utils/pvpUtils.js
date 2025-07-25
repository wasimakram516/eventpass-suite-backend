const emitPvpSessionWithQuestions = async (session, Game, emitToRoom, trigger, GameSession) => {
  const total = Game.questions.length;
  if (total < 5) throw new Error("Not enough questions (min 5)");

  const generateRandomOrder = (length) =>
    [...Array(length).keys()].sort(() => Math.random() - 0.5);

  session.questionsAssigned.Player1 = generateRandomOrder(total);
  session.questionsAssigned.Player2 = generateRandomOrder(total);

  session.status = "active";
  session.startTime = new Date();
  session.endTime = new Date(session.startTime.getTime() + Game.gameSessionTimer * 1000);

  await session.save();

  const mapIndexesToQuestions = (indexes) => indexes.map((i) => Game.questions[i]);

  const player1Questions = mapIndexesToQuestions(session.questionsAssigned.Player1 || []);
  const player2Questions = mapIndexesToQuestions(session.questionsAssigned.Player2 || []);

  const populatedSession = await GameSession.findById(session._id).populate(
    "players.playerId winner gameId"
  );

  emitToRoom(Game.slug, trigger, {
    populatedSession,
    player1Questions,
    player2Questions,
  });
};
module.exports = { emitPvpSessionWithQuestions };
