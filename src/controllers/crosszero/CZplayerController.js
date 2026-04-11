const XLSX = require("xlsx");
const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const Player = require("../../models/Player");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const {
  buildMetadataRows,
  buildWorksheet,
  formatDateTime,
  getAiOutcomeLabel,
} = require("../../utils/crosszeroExport");

// ─────────────────────────────────────────────────────────────
// JOIN GAME (AI mode — creates player + session)
// ─────────────────────────────────────────────────────────────
exports.joinGame = asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const { name, company, department } = req.body;

  if (!name) return response(res, 400, "Name is required");

  const game = await Game.findOne({ _id: gameId, type: "xo", mode: "solo" });
  if (!game) return response(res, 404, "CrossZero AI game not found");

  const player = await Player.create({ name, company, department });

  const session = await GameSession.create({
    gameId,
    players: [{ playerId: player._id, playerType: "solo", score: 0, timeTaken: 0 }],
    xoStats: {
      board: Array(9).fill(null),
      currentTurn: "X",
      moves: 0,
      result: null,
    },
    status: "active",
    startTime: new Date(),
  });

  player.sessionId = session._id;
  await player.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "CrossZero AI session started", {
    playerId: player._id,
    sessionId: session._id,
    mark: "X", // player always plays as X; AI plays as O
  });
});

// ─────────────────────────────────────────────────────────────
// SUBMIT RESULT (AI mode)
// ─────────────────────────────────────────────────────────────
exports.submitResult = asyncHandler(async (req, res) => {
  const { sessionId, playerId } = req.params;
  const { result, moves, timeTaken, difficulty } = req.body;

  if (!result || !["X_wins", "O_wins", "draw"].includes(result)) {
    return response(res, 400, "result must be X_wins, O_wins, or draw");
  }

  const session = await GameSession.findById(sessionId).populate("gameId");
  if (!session || session.gameId?.type !== "xo" || session.gameId?.mode !== "solo") {
    return response(res, 404, "CrossZero AI session not found");
  }

  const playerData = session.players.find((p) => p.playerId.toString() === playerId);
  if (!playerData) return response(res, 404, "Player not found in session");

  if (session.status === "completed") {
    return response(res, 200, "Session already completed");
  }

  session.xoStats.result = result;
  session.xoStats.moves = moves || 0;
  session.xoStats.timeTaken = timeTaken || 0;
  session.xoStats.difficulty = difficulty || "easy";

  playerData.score = result === "X_wins" ? 1 : 0;
  playerData.timeTaken = timeTaken || 0;

  session.status = "completed";
  session.endTime = new Date();
  await session.save();

  recomputeAndEmit(session.gameId?.businessId || null).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero AI result submitted", session.xoStats);
});

// ─────────────────────────────────────────────────────────────
// GET SESSION HISTORY (admin)
// ─────────────────────────────────────────────────────────────
exports.getSessionHistory = asyncHandler(async (req, res) => {
  const { gameId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const totalCount = await GameSession.countDocuments({ gameId, status: "completed" });

  const sessions = await GameSession.find({ gameId, status: "completed" })
    .populate("players.playerId", "name company department")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return response(res, 200, "Session history retrieved", {
    sessions,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  });
});

// ─────────────────────────────────────────────────────────────
// EXPORT RESULTS (admin)
// ─────────────────────────────────────────────────────────────
exports.exportResults = asyncHandler(async (req, res) => {
  const { gameId } = req.params;

  const game = await Game.findOne({ _id: gameId, type: "xo", mode: "solo" }).populate("businessId", "name");
  if (!game) return response(res, 404, "CrossZero AI game not found");

  const sessions = await GameSession.find({ gameId, status: "completed" }).populate("players.playerId");
  if (!sessions.length) return response(res, 404, "No sessions to export");

  const metadataRows = buildMetadataRows(game, "CrossZero AI", sessions.length, [
    ["Player Mark", "X"],
    ["AI Mark", "O"],
  ]);

  const headers = [
    "Sr. No.",
    "Session ID",
    "Player Name",
    "Company",
    "Department",
    "Outcome",
    "Difficulty",
    "Moves",
    "Time Taken (s)",
    "Started At",
    "Completed At",
  ];

  const dataRows = sessions.map((s, index) => {
    const p = s.players[0];
    return [
      index + 1,
      s._id.toString(),
      p?.playerId?.name || "Unknown",
      p?.playerId?.company || "-",
      p?.playerId?.department || "-",
      getAiOutcomeLabel(s.xoStats?.result),
      s.xoStats?.difficulty || "-",
      s.xoStats?.moves || 0,
      s.xoStats?.timeTaken || 0,
      formatDateTime(s.startTime),
      formatDateTime(s.endTime),
    ];
  });

  const worksheet = buildWorksheet(metadataRows, headers, dataRows, [10, 28, 24, 24, 20, 20, 14, 10, 14, 22, 22]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });

  const safe = (s) => s.replace(/[^\w\u0600-\u06FF-]/g, "_");
  const filename = `${safe(game.businessId?.name || "Business")}-${safe(game.title)}-CrossZero-AI-Results.xlsx`;

  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8");
  return res.send(buffer);
});
