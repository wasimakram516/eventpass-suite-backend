const Player = require("../../models/Player");
const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const moment = require("moment");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// ---------------------------------------------------------
// Export all TapMatch player results to Excel (with Game + Business details)
// ---------------------------------------------------------
exports.exportResults = asyncHandler(async (req, res) => {
  const { gameId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(gameId))
    return response(res, 400, "Invalid game ID");

  const game = await Game.findOne({
    _id: gameId,
    type: "memory",
    mode: "solo",
  })
    .populate("businessId", "name email phone website")
    .notDeleted();

  if (!game) return response(res, 404, "TapMatch game not found");

  const sessions = await GameSession.find({ gameId })
    .notDeleted()
    .populate("players.playerId");

  if (!sessions.length)
    return response(res, 404, "No TapMatch sessions to export");

  const exportData = sessions.flatMap((session) =>
    session.players.map((p) => ({
      Name: p.playerId?.name || "Unknown",
      Company: p.playerId?.company || "-",
      Phone: p.playerId?.phone || "-",
      Moves: session.memoryStats?.moves || 0,
      Matches: session.memoryStats?.matches || 0,
      Misses: session.memoryStats?.misses || 0,
      Accuracy: `${session.memoryStats?.accuracy || 0}%`,
      TotalTime: `${session.memoryStats?.totalTime || 0} sec`,
      SubmittedAt: moment(session.updatedAt).format("YYYY-MM-DD hh:mm A"),
    }))
  );

  const metadata = [
    { A: "Business Name:", B: game.businessId?.name || "-" },
    { A: "Game Title:", B: game.title },
    { A: "Game Type:", B: "TapMatch (Memory Game)" },
    { A: "Total Players:", B: exportData.length },
    { A: "Export Date:", B: moment().format("YYYY-MM-DD hh:mm A") },
    {},
  ];

  const metadataSheet = XLSX.utils.json_to_sheet(metadata, {
    skipHeader: true,
  });
  const resultsSheet = XLSX.utils.json_to_sheet(exportData, { origin: "A7" });

  const worksheet = { ...metadataSheet, ...resultsSheet };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

  const sanitizeFilename = (name) => name.replace(/[^\w\u0600-\u06FF-]/g, "_");
  const safeCompany = sanitizeFilename(game.businessId?.name || "Unknown");
  const safeTitle = sanitizeFilename(game.title);
  const filename = `${safeCompany}-${safeTitle}-TapMatch-Results.xlsx`;

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

// ---------------------------------------------------------
// Join TapMatch game (pre-game setup)
// ---------------------------------------------------------
exports.joinGame = asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const { name, company, phone } = req.body;

  if (!name) return response(res, 400, "Name is required");

  const game = await Game.findOne({
    _id: gameId,
    type: "memory",
    mode: "solo",
  }).notDeleted();
  if (!game) return response(res, 404, "TapMatch game not found");

  if (!game.memoryImages || game.memoryImages.length === 0) {
    return response(res, 400, "Wait for admin to add memory matching images to proceed.");
  }

  const player = await Player.create({ name, company, phone });

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
    memoryStats: {
      moves: 0,
      matches: 0,
      misses: 0,
      totalTime: 0,
      accuracy: 0,
    },
    status: "active",
    startTime: new Date(),
  });

  return response(res, 201, "TapMatch session started", {
    playerId: player._id,
    sessionId: session._id,
  });
});

// ---------------------------------------------------------
// Submit TapMatch result
// ---------------------------------------------------------
exports.submitResult = asyncHandler(async (req, res) => {
  const { sessionId, playerId } = req.params;
  const { moves, matches, misses, totalTime, accuracy } = req.body;

  const session = await GameSession.findById(sessionId)
    .notDeleted()
    .populate("gameId");

  if (!session || session.gameId.type !== "memory")
    return response(res, 404, "TapMatch session not found");

  const playerData = session.players.find(
    (p) => p.playerId.toString() === playerId
  );
  if (!playerData)
    return response(res, 404, "Player not found in session");

  if (session.status === "completed") {
    return response(res, 200, "Session is already completed, please join again");
  }

  session.memoryStats = {
    moves: moves || 0,
    matches: matches || 0,
    misses: misses || 0,
    totalTime: totalTime || 0,
    accuracy: accuracy || 0,
  };

  session.status = "completed";
  session.endTime = new Date();
  await session.save();

  // Trigger recompute for dashboard updates
  recomputeAndEmit(session.gameId.businessId || null).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "TapMatch result submitted", session.memoryStats);
});


// ---------------------------------------------------------
// Get all players of a TapMatch game
// ---------------------------------------------------------
exports.getPlayersByGame = asyncHandler(async (req, res) => {
  const { gameId } = req.params;

  const sessions = await GameSession.find({ gameId })
    .notDeleted()
    .populate("players.playerId");

  const allPlayers = sessions.flatMap((session) =>
    session.players.map((p) => ({
      name: p.playerId?.name,
      company: p.playerId?.company,
      moves: session.memoryStats?.moves,
      matches: session.memoryStats?.matches,
      misses: session.memoryStats?.misses,
      accuracy: session.memoryStats?.accuracy,
      totalTime: session.memoryStats?.totalTime,
      sessionId: session._id,
    }))
  );

  return response(res, 200, "Players retrieved", allPlayers);
});

// ---------------------------------------------------------
// Get TapMatch leaderboard
// ---------------------------------------------------------
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Find completed sessions
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
      moves: session.memoryStats?.moves || 0,
      matches: session.memoryStats?.matches || 0,
      misses: session.memoryStats?.misses || 0,
      accuracy: session.memoryStats?.accuracy || 0,
      totalTime: session.memoryStats?.totalTime || 0,
      sessionId: session._id,
      endTime: session.endTime,
    }))
  );

  // Sort once before slicing
  results.sort((a, b) => {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (a.moves !== b.moves) return a.moves - b.moves;
    return a.totalTime - b.totalTime;
  });

  const total = results.length;
  const paginated = results.slice(skip, skip + limit);

  return response(res, 200, "TapMatch leaderboard", {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    results: paginated,
  });
});

