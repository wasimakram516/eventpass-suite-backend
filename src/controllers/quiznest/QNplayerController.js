const Player = require("../../models/Player");
const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const moment = require("moment");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// Export all player results to Excel
exports.exportResults = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  if (!mongoose.Types.ObjectId.isValid(gameId)) {
    return response(res, 400, "Invalid game ID");
  }

  const game = await Game.findOne({
    _id: gameId,
    type: "quiz",
    mode: "solo",
  })
    .populate("businessId", "name")
    .notDeleted();

  if (!game) return response(res, 404, "Game not found or invalid type/mode");

  const sessions = await GameSession.find({
    gameId,
  })
    .notDeleted()
    .populate("players.playerId");

  const exportData = sessions.flatMap((session) =>
    session.players.map((p) => ({
      Name: p.playerId?.name || "Unknown",
      Company: p.playerId?.company || "-",
      Score: p.score,
      TimeTaken: p.timeTaken,
      AttemptedQuestions: p.attemptedQuestions,
      SubmittedAt: moment(session.updatedAt).format("YYYY-MM-DD hh:mm A"),
    }))
  );

  if (!exportData.length) {
    return response(res, 404, "No Game sessions to export");
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

// Join game (pre-game)
exports.joinGame = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;
  const { name, company } = req.body;

  if (!name) return response(res, 400, "Name is required");

  const game = await Game.findOne({
    _id: gameId,
    type: "quiz",
    mode: "solo",
  }).notDeleted();

  if (!game) return response(res, 404, "Game not found or invalid type/mode");

  // 1. Create Player
  const player = await Player.create({ name, company });

  // 2. Assign full set of questions (all indexes)
  const allIndexes = game.questions.map((_, idx) => idx);

  // 3. Create GameSession
  const session = await GameSession.create({
    gameId,
    players: [
      {
        playerId: player._id,
        playerType: "solo",
        score: 0,
        timeTaken: 0,
        attemptedQuestions: 0,
      },
    ],
    questionsAssigned: { solo: allIndexes },
    startTime: new Date(),
  });

  return response(res, 201, "Solo game session started", {
    playerId: player._id,
    sessionId: session._id,
  });
});

// Submit game result (after game ends)
exports.submitResult = asyncHandler(async (req, res) => {
  const { sessionId, playerId } = req.params;
  const { score, timeTaken, attemptedQuestions } = req.body;

  const session = await GameSession.findById(sessionId)
    .notDeleted()
    .populate("gameId");

  if (!session) return response(res, 404, "Game session not found");

  if (
    !session.gameId ||
    session.gameId.type !== "quiz" ||
    session.gameId.mode !== "solo"
  ) {
    return response(res, 400, "Invalid game type or mode");
  }

  const playerData = session.players.find(
    (p) => p.playerId.toString() === playerId
  );
  if (!playerData) return response(res, 404, "Player not in session");

  playerData.score = score;
  playerData.timeTaken = timeTaken;
  playerData.attemptedQuestions = attemptedQuestions;

  session.status = "completed";
  session.endTime = new Date();
  await session.save();

  // Fire background recompute
  recomputeAndEmit(session.gameId.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Result submitted", playerData);
});

// Get all players for a game
exports.getPlayersByGame = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  const game = await Game.findOne({
    _id: gameId,
    type: "quiz",
    mode: "solo",
  }).notDeleted();

  if (!game) return response(res, 404, "Game not found or invalid type/mode");

  const sessions = await GameSession.find({ gameId })
    .notDeleted()
    .populate("players.playerId");

  const allPlayers = sessions.flatMap((session) =>
    session.players.map((p) => ({
      name: p.playerId.name,
      company: p.playerId.company,
      score: p.score,
      timeTaken: p.timeTaken,
      attemptedQuestions: p.attemptedQuestions,
      sessionId: session._id,
    }))
  );

  return response(res, 200, "Players retrieved", allPlayers);
});

// Get leaderboard for a game
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  const game = await Game.findOne({
    _id: gameId,
    type: "quiz",
    mode: "solo",
  }).notDeleted();

  if (!game) return response(res, 404, "Game not found or invalid type/mode");

  const sessions = await GameSession.find({
    gameId,
    status: "completed",
  })
    .notDeleted()
    .populate("players.playerId");

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
