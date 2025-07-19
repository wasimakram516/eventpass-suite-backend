const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const Player = require("../../models/Player");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { emitUpdate } = require("../../utils/socketUtils");

// Get all sessions
exports.getGameSessions = asyncHandler(async (req, res) => {
  const sessions = await GameSession.find()
    .populate("players.playerId winner gameId")
    .sort({ createdAt: -1 });
  return response(res, 200, "Sessions retrieved", sessions);
});

// Start a new session
exports.startGameSession = asyncHandler(async (req, res) => {
  const { gameId } = req.body;

  const existing = await GameSession.findOne({
    gameId,
    status: { $in: ["pending", "active"] },
  });
  if (existing)
    return response(res, 400, "Session already in progress for this game.");

  const game = await Game.findById(gameId);
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid or non-PvP game.");

  const session = await GameSession.create({
    gameId,
    players: [],
    questionsAssigned: { Player1: [], Player2: [] },
    status: "pending",
  });

  // Emit updated sessions list
  const allSessions = await GameSession.find()
    .populate("players.playerId winner gameId")
    .sort({ createdAt: -1 });
 
  emitUpdate("pvpSessionsUpdate", allSessions);

  return response(res, 201, "New PvP session started", session);
});

// Join session
exports.joinGameSession = asyncHandler(async (req, res) => {
  const { gameId, name, company, playerType } = req.body;

  if (!["p1", "p2"].includes(playerType))
    return response(res, 400, "Invalid playerType. It should be 'p1' or 'p2'.");

  const session = await GameSession.findOne({ gameId, status: "pending" });
  if (!session) return response(res, 404, "No pending session for this game.");

  const slotTaken = session.players.some((p) => p.playerType === playerType);
  if (slotTaken) return response(res, 400, `Slot ${playerType} already taken`);

  const player = await Player.create({ name, company });

  session.players.push({
    playerId: player._id,
    playerType,
    score: 0,
    timeTaken: 0,
    attemptedQuestions: 0,
  });

  await session.save();

  emitUpdate("pvpSessionUpdate", session);
  return response(res, 201, `${name} joined as ${playerType}`, {
    player,
    session,
  });
});

// Activate session
exports.activateGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const session = await GameSession.findById(sessionId).populate("gameId");
  if (!session) return response(res, 404, "Session not found");

  const game = session.gameId;
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid PvP game");

  if (session.players.length < 2)
    return response(res, 400, "Both players required");

  const total = game.questions.length;
  if (total < 5) return response(res, 400, "Not enough questions (min 5)");

  const generateRandomOrder = (length) => {
    return [...Array(length).keys()].sort(() => Math.random() - 0.5);
  };

  session.questionsAssigned.Player1 = generateRandomOrder(total);
  session.questionsAssigned.Player2 = generateRandomOrder(total);

  session.status = "active";
  session.startTime = new Date();
  session.endTime = new Date(
    session.startTime.getTime() + game.gameSessionTimer * 1000
  );

  await session.save();

  // Emit updated session
  emitUpdate("pvpSessionUpdate", session);

  return response(res, 200, "Session activated", session);
});

// Submit result for a player
exports.submitPvPResult = asyncHandler(async (req, res) => {
  const { sessionId, playerId } = req.params;
  const { score, timeTaken, attemptedQuestions } = req.body;

  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  const playerStats = session.players.find(
    (p) => p.playerId.toString() === playerId
  );
  if (!playerStats) return response(res, 404, "Player not in session");

  playerStats.score = score;
  playerStats.timeTaken = timeTaken;
  playerStats.attemptedQuestions = attemptedQuestions;

  await session.save();

  // Emit session update to reflect new stats
  emitUpdate("pvpSessionUpdate", session);

  return response(res, 200, "Player result saved", playerStats);
});

// End session & decide winner
exports.endGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  const [p1, p2] = session.players;

  let winner = null;
  if (p1?.score > p2?.score) winner = p1.playerId;
  else if (p2?.score > p1?.score) winner = p2.playerId;

  session.winner = winner;
  session.status = "completed";

  await session.save();

  // Emit to update session view
  emitUpdate("pvpSessionEnded", session);

  // Also emit full list refresh
  const allSessions = await GameSession.find()
    .populate("players.playerId winner gameId")
    .sort({ createdAt: -1 });

  emitUpdate("pvpSessionsUpdate", allSessions);

  return response(res, 200, "Session completed", session);
});

// Export all player results to Excel
exports.exportResults = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  if (!mongoose.Types.ObjectId.isValid(gameId)) {
    return response(res, 400, "Invalid game ID");
  }

  const game = await Game.findById(gameId).populate("businessId", "name");
  if (!game) return response(res, 404, "Game not found");

  const sessions = await GameSession.find({
    gameId,
    status: "completed",
  }).populate("players.playerId");

  const exportData = sessions.flatMap((session) =>
    session.players.map((p) => ({
      Name: p.playerId?.name || "Unknown",
      Company: p.playerId?.company || "-",
      Score: p.score,
      TimeTaken: p.timeTaken,
      AttemptedQuestions: p.attemptedQuestions,
      SubmittedAt: session.updatedAt.toISOString(),
    }))
  );

  if (!exportData.length) {
    return response(res, 404, "No completed sessions to export");
  }

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

  const sanitizeFilename = (name) => name.replace(/[^\w\u0600-\u06FF-]/g, "_");
  const safeCompany = sanitizeFilename(game.businessId.name);
  const safeTitle = sanitizeFilename(game.title);
  const filename = `${safeCompany}-${safeTitle}-results.xlsx`;

  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8"
  );

  return res.send(buffer);
});

// Get leaderboard for a game
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  const sessions = await GameSession.find({
    gameId,
    status: "completed",
  }).populate("players.playerId");

  const results = sessions.flatMap((session) =>
    session.players.map((p) => ({
      name: p.playerId?.name || "Unknown",
      company: p.playerId?.company || "-",
      score: p.score,
      timeTaken: p.timeTaken,
      attemptedQuestions: p.attemptedQuestions,
      sessionId: session._id,
      endTime: session.endTime,
    }))
  );

  // Sort: score DESC, timeTaken ASC
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.timeTaken - b.timeTaken;
  });

  return response(res, 200, "Leaderboard", results);
});
