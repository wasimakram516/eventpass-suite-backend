const XLSX = require("xlsx");
const moment = require("moment");
const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const Player = require("../../models/Player");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { emitToRoom } = require("../../utils/socketUtils");
const { emitPvpSessionWithQuestions } = require("../../utils/pvpUtils");

// Get all sessions for a specific game by slug
exports.getGameSessions = asyncHandler(async (req, res) => {
  const { gameSlug, page = 1, limit = 5 } = req.query;

  if (!gameSlug) {
    return response(res, 400, "Missing gameSlug in query");
  }

  const game = await Game.findOne({ slug: gameSlug });
  if (!game) {
    return response(res, 404, "Game not found");
  }

  const pageNumber = parseInt(page);
  const pageSize = parseInt(limit);
  const skip = (pageNumber - 1) * pageSize;

  const totalCount = await GameSession.countDocuments({ gameId: game._id });

  const sessions = await GameSession.find({
    gameId: game._id,
    status: "completed",
  })
    .populate("players.playerId winner gameId")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize);

  return response(res, 200, "Sessions retrieved", {
    sessions,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
    currentPage: pageNumber,
  });
});

// Start a new session
exports.startGameSession = asyncHandler(async (req, res) => {
  const { gameSlug } = req.body;
  if (!gameSlug) {
    return response(res, 400, "Missing gameSlug in request body");
  }

  const game = await Game.findOne({ slug: gameSlug });
  if (!game || game.mode !== "pvp") {
    return response(res, 404, "Game not found");
  }

  const gameId = game._id;

  const existing = await GameSession.findOne({
    gameId,
    status: { $in: ["pending", "active"] },
  });
  if (existing)
    return response(res, 400, "Session already in progress for this game.");

  const session = await GameSession.create({
    gameId,
    players: [],
    questionsAssigned: { Player1: [], Player2: [] },
    status: "pending",
  });

  const populatedSession = await GameSession.findById(session._id).populate(
    "players.playerId winner gameId"
  );

  // Emit single session creation
  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  return response(res, 201, "New PvP session started", session);
});

// Join session
exports.joinGameSession = asyncHandler(async (req, res) => {
  const { gameSlug, name, company, playerType } = req.body;
  if (!gameSlug || !name || !playerType) {
    return response(
      res,
      400,
      "Missing required fields: gameSlug, name, playerType"
    );
  }

  if (!["p1", "p2"].includes(playerType))
    return response(res, 400, "Invalid playerType. It should be 'p1' or 'p2'.");

  const game = await Game.findOne({ slug: gameSlug });
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid or non-PvP game.");

  const gameId = game._id;

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

  // Re-fetch latest 5 sessions and emit updated list
  const allSessions = await GameSession.find({ gameId: session.gameId })
    .populate("players.playerId winner gameId")
    .sort({ createdAt: -1 })
    .limit(5);

  emitToRoom(game.slug, "pvpAllSessions", allSessions);

  const populatedSession = await GameSession.findById(session._id).populate(
    "players.playerId winner gameId"
  );
  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  return response(res, 201, `${name} joined as ${playerType}`, {
    player,
    session,
  });
});

// Activate session
exports.activateGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  let session = await GameSession.findById(sessionId).populate("gameId");
  if (!session) return response(res, 404, "Session not found");

  const game = await Game.findById(session.gameId);
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid PvP game");

  if (session.players.length < 2)
    return response(res, 400, "Both players required");

  await emitPvpSessionWithQuestions(
    session,
    game,
    emitToRoom,
    "pvpCurrentSession",
    GameSession
  );

  return response(res, 200, "Session activated", session);
});

// Submit result for a player
exports.submitPvPResult = asyncHandler(async (req, res) => {
  const { sessionId, playerId } = req.params;
  const { score, timeTaken, attemptedQuestions } = req.body;

  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  const game = await Game.findById(session.gameId);
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid or non-PvP game.");

  const playerStats = session.players.find(
    (p) => p.playerId.toString() === playerId
  );
  if (!playerStats) return response(res, 404, "Player not in session");

  playerStats.score = score;
  playerStats.timeTaken = timeTaken;
  playerStats.attemptedQuestions = attemptedQuestions;

  await session.save();

  // Re-emit session update (no need to reassign questions!)
  const mapIndexesToQuestions = (indexes) =>
    indexes.map((i) => game.questions[i]);

  const player1Questions = mapIndexesToQuestions(
    session.questionsAssigned.Player1 || []
  );
  const player2Questions = mapIndexesToQuestions(
    session.questionsAssigned.Player2 || []
  );

  const populatedSession = await GameSession.findById(session._id).populate(
    "players.playerId winner gameId"
  );

  emitToRoom(game.slug, "pvpCurrentSession", {
    populatedSession,
    player1Questions,
    player2Questions,
  });

  return response(res, 200, "Player result saved", playerStats);
});

// End session & decide winner
exports.endGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  
  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  const game = await Game.findById(session.gameId);
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid or non-PvP game.");

  // Wait 500ms to allow clients to submit their stats
  emitToRoom(game.slug, "forceSubmitPvP", { sessionId });
  await new Promise((r) => setTimeout(r, 500));

  const [p1, p2] = session.players;

  let winner = null;

  if (p1?.score > p2?.score) {
    winner = p1.playerId;
  } else if (p2?.score > p1?.score) {
    winner = p2.playerId;
  } else {
    // If scores are equal, decide by lower time taken
    if (p1?.timeTaken < p2?.timeTaken) {
      winner = p1.playerId;
    } else if (p2?.timeTaken < p1?.timeTaken) {
      winner = p2.playerId;
    } else {
      // Scores and time taken are equal — it's a draw
      winner = null;
    }
  }

  session.winner = winner;
  session.status = "completed";

  await session.save();

  const populatedSession = await GameSession.findById(session._id).populate(
    "players.playerId winner gameId"
  );
  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  return response(res, 200, "Session completed", session);
});

// Reset all sessions for a given gameSlug
exports.resetGameSessions = asyncHandler(async (req, res) => {
  const { gameSlug } = req.body;

  if (!gameSlug) {
    return response(res, 400, "Missing gameSlug in request body");
  }

  const game = await Game.findOne({ slug: gameSlug });
  if (!game || game.mode !== "pvp") {
    return response(res, 404, "Game not found");
  }

  const gameId = game._id;

  // Find all Completed sessions for the game
  const sessions = await GameSession.find({ gameId, status: "completed" });

  // Collect all playerIds used in these sessions
  const allPlayerIds = sessions.flatMap((session) =>
    session.players.map((p) => p.playerId)
  );

  // Delete all sessions
  await GameSession.deleteMany({ gameId });

  // Delete related players (safe even if playerIds are empty)
  await Player.deleteMany({ _id: { $in: allPlayerIds } });

  // Emit session update to room
  emitToRoom(gameSlug, "pvpCurrentSession", null);
  emitToRoom(gameSlug, "pvpAllSessions", []);

  return response(res, 200, "All sessions and players reset for this game");
});

// Export all player results to Excel
exports.exportResults = asyncHandler(async (req, res) => {
  const gameSlug = req.params.gameSlug;

  const game = await Game.findOne({ slug: gameSlug }).populate("businessId", "name");
  if (!game) return response(res, 404, "Game not found");

  const sessions = await GameSession.find({ gameId: game._id, status: "completed" })
    .populate("players.playerId");

  if (!sessions.length) return response(res, 404, "No completed sessions");

  const allSessionData = [];

  sessions.forEach((session) => {
    const p1 = session.players.find((p) => p.playerType === "p1");
    const p2 = session.players.find((p) => p.playerType === "p2");

    allSessionData.push({
      "Session ID": session._id.toString(),
      "Submitted At": moment(session.updatedAt).format("YYYY-MM-DD hh:mm A"),

      "Player 1 Name": p1?.playerId?.name || "Unknown",
      "Player 1 Company": p1?.playerId?.company || "-",
      "Player 1 Score": p1?.score ?? "-",
      "Player 1 Time Taken (sec)": p1?.timeTaken ?? "-",
      "Player 1 Attempted": p1?.attemptedQuestions ?? "-",

      "Player 2 Name": p2?.playerId?.name || "Unknown",
      "Player 2 Company": p2?.playerId?.company || "-",
      "Player 2 Score": p2?.score ?? "-",
      "Player 2 Time Taken (sec)": p2?.timeTaken ?? "-",
      "Player 2 Attempted": p2?.attemptedQuestions ?? "-",
    });
  });

  const summary = [
    ["Game Title", game.title],
    ["Business Name", game.businessId.name],
    ["Total PvP Sessions", sessions.length],
    ["Exported At", moment().format("YYYY-MM-DD hh:mm A")],
    [], // blank row before table
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.sheet_add_json(summarySheet, allSessionData, { origin: -1 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "PvP Results");

  const sanitizeFilename = (name) => name.replace(/[^\w\u0600-\u06FF-]/g, "_");
  const safeCompany = sanitizeFilename(game.businessId.name);
  const safeTitle = sanitizeFilename(game.title);
  const filename = `${safeCompany}-${safeTitle}-results.xlsx`;

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

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
  const gameSlug = req.params.gameSlug;

  const game = await Game.findOne({ slug: gameSlug });
  if (!game) return response(res, 404, "Game not found");
  if (game.mode !== "pvp") {
    return response(res, 400, "Leaderboard only available for PvP games");
  }
  const gameId = game._id;
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
