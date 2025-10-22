const emitPvpSessionWithQuestions = async (
  session,
  game,
  emitToRoom,
  trigger,
  GameSession
) => {
  const total = game.questions.length;
  if (total < 5) throw new Error("Not enough questions (min 5)");

  const generateRandomOrder = (length) =>
    [...Array(length).keys()].sort(() => Math.random() - 0.5);

  // --- PvP Mode ---
  if (!game.isTeamMode) {
    session.questionsAssigned.Player1 = generateRandomOrder(total);
    session.questionsAssigned.Player2 = generateRandomOrder(total);
  } else {
    // --- Team Mode ---
    session.questionsAssigned.Teams = game.teams.map((teamId) => ({
      teamId,
      questionIndexes: generateRandomOrder(total),
    }));
  }

  session.status = "active";
  session.startTime = new Date();
  session.endTime = new Date(
    session.startTime.getTime() + game.gameSessionTimer * 1000
  );

  await session.save();

  // --- Build questions for emit ---
  const mapIndexesToQuestions = (indexes) =>
    (indexes || []).map((i) => game.questions[i]);

  let payload = {};

  if (!game.isTeamMode) {
    // PvP mode
    payload = {
      player1Questions: mapIndexesToQuestions(
        session.questionsAssigned.Player1
      ),
      player2Questions: mapIndexesToQuestions(
        session.questionsAssigned.Player2
      ),
    };
  } else {
    // Team mode
    payload = {
      teamQuestions: session.questionsAssigned.Teams.map((t) => ({
        teamId: t.teamId,
        questionSet: mapIndexesToQuestions(t.questionIndexes),
      })),
    };
  }

  // --- Populate and emit ---
  const populatedSession = await GameSession.findById(session._id).populate(
    game.isTeamMode
      ? [
          { path: "teams.teamId" },
          { path: "winnerTeamId" },
          { path: "gameId" },
        ]
      : [
          { path: "players.playerId" },
          { path: "winner" },
          { path: "gameId" },
        ]
  );

  emitToRoom(game.slug, trigger, {
    populatedSession,
    ...payload,
  });
};

module.exports = { emitPvpSessionWithQuestions };
