const Player = require("../../models/Player");
const Game = require("../../models/Game");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const XLSX = require("xlsx");
const mongoose = require("mongoose");

// ✅ Export all player results to Excel
exports.exportResults = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  if (!mongoose.Types.ObjectId.isValid(gameId)) {
    return response(res, 400, "Invalid game ID");
  }

  const game = await Game.findById(gameId).populate("businessId", "name");
  if (!game) return response(res, 404, "Game not found");

  const players = await Player.find({ gameId, status: "played" }).sort({
    score: -1,
    timeTaken: 1,
  });

  const exportData = players.map((p) => ({
    Name: p.name,
    // Company: p.company || "-",
    Score: p.score,
    TimeTaken: p.timeTaken,
    AttemptedQuestions: p.attemptedQuestions,
    SubmittedAt: p.status === "played" ? p.updatedAt.toISOString() : "-",
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");

  // explicitly set UTF-8 encoding
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

  // safer filename generation (allowing Unicode)
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

// ✅ Join game (pre-game)
exports.joinGame = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;
  const { name, company } = req.body;

  if (!name) return response(res, 400, "Name is required");

  const game = await Game.findById(gameId);
  if (!game) return response(res, 404, "Game not found");

  const player = await Player.create({
    gameId,
    name,
    company,
    status: "joined",
  });

  return response(res, 201, "Player joined", { playerId: player._id });
});

// ✅ Submit game result (after game ends)
exports.submitResult = asyncHandler(async (req, res) => {
  const playerId = req.params.id;
  const { score, timeTaken, attemptedQuestions } = req.body;

  const player = await Player.findById(playerId);
  if (!player) return response(res, 404, "Player not found");

  if (player.status === "played") {
    return response(res, 400, "Result already submitted");
  }

  player.score = score;
  player.timeTaken = timeTaken;
  player.attemptedQuestions = attemptedQuestions;
  player.status = "played";

  await player.save();

  return response(res, 200, "Player result submitted", player);
});

// ✅ Get all players for a game
exports.getPlayersByGame = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;
  const players = await Player.find({ gameId }).sort({ createdAt: -1 });

  return response(res, 200, "Players retrieved", players);
});

// ✅ Get leaderboard for a game
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const gameId = req.params.gameId;

  const players = await Player.find({ gameId, status: "played" }).sort({
    score: -1,
    timeTaken: 1,
  });

  return response(res, 200, "Leaderboard", players);
});
