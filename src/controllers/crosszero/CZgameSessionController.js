const XLSX = require("xlsx");
const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const Player = require("../../models/Player");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { emitToRoom } = require("../../utils/socketUtils");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const {
  buildMetadataRows,
  buildWorksheet,
  formatDateTime,
  getPvpOutcomeLabel,
} = require("../../utils/crosszeroExport");

const CZ_FILTER = { type: "xo", mode: "pvp" };
const PLAYER_MARKS = { p1: "X", p2: "O" };

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkWinner(board) {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function isDraw(board) {
  return board.every((cell) => cell !== null) && !checkWinner(board);
}

function populateSession(query) {
  return query.populate([
    { path: "players.playerId", select: "name company department" },
    { path: "winner", select: "name company department" },
    { path: "gameId", select: "title slug mode type moveTimer countdownTimer gameSessionTimer xImage oImage" },
  ]);
}

async function getRecentSessions(gameId) {
  return populateSession(
    GameSession.find({ gameId }).sort({ createdAt: -1 }).limit(5)
  );
}

async function emitLobbySessions(gameSlug, gameId) {
  const sessions = await getRecentSessions(gameId);
  emitToRoom(gameSlug, "cz:sessionsUpdate", sessions);
  emitToRoom(gameSlug, "cz:allSessions", sessions);
  return sessions;
}

async function emitSessionAndLobby(sessionId) {
  const populated = await populateSession(GameSession.findById(sessionId));
  if (!populated) return null;

  const gameSlug = populated.gameId?.slug || "";
  emitToRoom(sessionId.toString(), "cz:sessionUpdate", populated);
  if (gameSlug) {
    await emitLobbySessions(gameSlug, populated.gameId?._id || populated.gameId);
  }
  return populated;
}

async function findPvpGameBySlug(gameSlug) {
  return Game.findOne({ slug: gameSlug, ...CZ_FILTER });
}

exports.getGameSessions = asyncHandler(async (req, res) => {
  const { gameSlug, page = 1, limit = 5 } = req.query;
  if (!gameSlug) return response(res, 400, "Missing gameSlug in query");

  const game = await findPvpGameBySlug(gameSlug);
  if (!game) return response(res, 404, "CrossZero PvP game not found");

  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;

  const totalCount = await GameSession.countDocuments({
    gameId: game._id,
    status: "completed",
  });

  const sessions = await populateSession(
    GameSession.find({ gameId: game._id, status: "completed" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
  );

  return response(res, 200, "CrossZero PvP sessions retrieved", {
    sessions,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
    currentPage: pageNumber,
  });
});

exports.startGameSession = asyncHandler(async (req, res) => {
  const { gameSlug } = req.body;
  if (!gameSlug) return response(res, 400, "Missing gameSlug");

  const game = await findPvpGameBySlug(gameSlug);
  if (!game) return response(res, 404, "CrossZero PvP game not found");

  const existing = await GameSession.findOne({
    gameId: game._id,
    status: { $in: ["pending", "active"] },
  });
  if (existing) {
    return response(res, 400, "Session already in progress for this game.");
  }

  const session = await GameSession.create({
    gameId: game._id,
    players: [],
    xoStats: {
      board: Array(9).fill(null),
      currentTurn: "X",
      moves: 0,
      result: null,
    },
    status: "pending",
  });

  const populated = await emitSessionAndLobby(session._id);
  return response(res, 201, "CrossZero session started", populated);
});

exports.joinGameSession = asyncHandler(async (req, res) => {
  const { gameSlug, sessionId, name, company, department, playerType } = req.body;

  if (!name || !playerType || !["p1", "p2"].includes(playerType)) {
    return response(
      res,
      400,
      "Missing required fields: name and playerType ('p1' or 'p2')"
    );
  }

  let game = null;
  if (gameSlug) {
    game = await findPvpGameBySlug(gameSlug);
    if (!game) return response(res, 404, "CrossZero PvP game not found");
  }

  let session = null;
  if (sessionId) {
    session = await GameSession.findOne({ _id: sessionId, status: "pending" });
  } else if (game) {
    session = await GameSession.findOne({
      gameId: game._id,
      status: "pending",
    });
  }

  if (!session) {
    return response(res, 404, "No pending session for this game.");
  }

  if (!game) {
    game = await Game.findOne({ _id: session.gameId, ...CZ_FILTER });
  }
  if (!game) return response(res, 404, "CrossZero PvP game not found");

  const slotTaken = session.players.some((player) => player.playerType === playerType);
  if (slotTaken) {
    const slotLabel = playerType === "p1" ? "Player 1 (X)" : "Player 2 (O)";
    return response(res, 400, `${slotLabel} slot is already taken. Please choose the other side.`);
  }

  if (session.players.length >= 2) {
    return response(res, 400, "Session is full.");
  }

  const player = await Player.create({
    name,
    company,
    department,
    sessionId: session._id,
  });

  session.players.push({
    playerId: player._id,
    playerType,
    score: 0,
    timeTaken: 0,
    attemptedQuestions: 0,
  });
  await session.save();

  const populated = await emitSessionAndLobby(session._id);

  return response(res, 201, `${name} joined as ${playerType}`, {
    playerId: player._id,
    sessionId: session._id,
    playerType,
    mark: PLAYER_MARKS[playerType],
    player,
    session: populated,
  });
});

exports.activateGameSession = asyncHandler(async (req, res) => {
  const session = await populateSession(
    GameSession.findOne({ _id: req.params.sessionId, status: "pending" })
  );
  if (!session) return response(res, 404, "Pending session not found");

  if (session.players.length < 2) {
    return response(res, 400, "Both players must join before activating");
  }

  const hasP1 = session.players.some((player) => player.playerType === "p1");
  const hasP2 = session.players.some((player) => player.playerType === "p2");
  if (!hasP1 || !hasP2) {
    return response(res, 400, "Both player slots must be filled");
  }

  session.status = "active";
  session.startTime = new Date();
  session.xoStats = {
    board: Array(9).fill(null),
    currentTurn: "X",
    moves: 0,
    result: null,
  };
  await session.save();

  const populated = await emitSessionAndLobby(session._id);
  return response(res, 200, "CrossZero session activated — game on!", populated);
});

exports.processMove = async (sessionId, playerId, cellIndex) => {
  const session = await GameSession.findOne({
    _id: sessionId,
    status: "active",
  }).populate("gameId");
  if (!session) throw new Error("Active session not found");

  const playerEntry = session.players.find(
    (player) => player.playerId.toString() === playerId.toString()
  );
  if (!playerEntry) throw new Error("Player not in this session");

  const mark = PLAYER_MARKS[playerEntry.playerType];
  if (session.xoStats.currentTurn !== mark) {
    throw new Error("Not your turn");
  }

  const board = [...session.xoStats.board];
  if (board[cellIndex] !== null) throw new Error("Cell already occupied");

  board[cellIndex] = mark;
  const winner = checkWinner(board);
  const draw = !winner && isDraw(board);

  session.xoStats.board = board;
  session.xoStats.moves += 1;
  session.xoStats.currentTurn = mark === "X" ? "O" : "X";

  if (winner) {
    session.xoStats.result = `${winner}_wins`;
    session.xoStats.timeTaken = Math.round(
      (Date.now() - new Date(session.startTime).getTime()) / 1000
    );
    session.status = "completed";
    session.endTime = new Date();

    const winnerEntry = session.players.find(
      (player) => PLAYER_MARKS[player.playerType] === winner
    );
    const loserEntry = session.players.find(
      (player) => PLAYER_MARKS[player.playerType] !== winner
    );

    if (winnerEntry) {
      session.winner = winnerEntry.playerId;
      winnerEntry.score = 1;
      winnerEntry.timeTaken = session.xoStats.timeTaken;
    }
    if (loserEntry) {
      loserEntry.score = 0;
      loserEntry.timeTaken = session.xoStats.timeTaken;
    }
  } else if (draw) {
    session.xoStats.result = "draw";
    session.xoStats.timeTaken = Math.round(
      (Date.now() - new Date(session.startTime).getTime()) / 1000
    );
    session.status = "completed";
    session.endTime = new Date();
    session.players.forEach((player) => {
      player.score = 0;
      player.timeTaken = session.xoStats.timeTaken;
    });
  }

  await session.save();

  if (session.status === "completed") {
    recomputeAndEmit(session.gameId?.businessId || null).catch((err) =>
      console.error("Recompute failed:", err.message)
    );
  }

  return session;
};

exports.endGameSession = asyncHandler(async (req, res) => {
  const session = await populateSession(
    GameSession.findOne({ _id: req.params.sessionId, status: "active" })
  );
  if (!session) return response(res, 404, "Active session not found");

  session.status = "completed";
  session.endTime = new Date();
  if (!session.xoStats.result) {
    session.xoStats.result = "draw";
    session.xoStats.timeTaken = Math.round(
      (Date.now() - new Date(session.startTime || session.createdAt).getTime()) / 1000
    );
  }
  await session.save();

  const populated = await emitSessionAndLobby(session._id);
  recomputeAndEmit(populated?.gameId?.businessId || null).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero session ended", populated);
});

exports.abandonGameSession = asyncHandler(async (req, res) => {
  const session = await populateSession(
    GameSession.findOne({ _id: req.params.sessionId, status: "pending" })
  );
  if (!session) return response(res, 404, "Pending session not found");

  session.status = "abandoned";
  session.endTime = new Date();
  await session.save();

  const populated = await emitSessionAndLobby(session._id);
  return response(res, 200, "CrossZero session abandoned", populated);
});

exports.resetGameSessions = asyncHandler(async (req, res) => {
  const { gameSlug } = req.body;
  if (!gameSlug) return response(res, 400, "Missing gameSlug");

  const game = await findPvpGameBySlug(gameSlug);
  if (!game) return response(res, 404, "CrossZero PvP game not found");

  const sessions = await GameSession.find({ gameId: game._id });
  const playerIds = sessions.flatMap((session) =>
    (session.players || []).map((player) => player.playerId)
  );

  if (playerIds.length) {
    await Player.deleteMany({ _id: { $in: playerIds } });
  }
  await GameSession.deleteMany({ gameId: game._id });

  emitToRoom(gameSlug, "cz:sessionsUpdate", []);
  emitToRoom(gameSlug, "cz:allSessions", []);

  return response(res, 200, "All CrossZero sessions reset");
});

// ─────────────────────────────────────────────────────────────
// TRASH — RESTORE / PERMANENT DELETE
// ─────────────────────────────────────────────────────────────
exports.restoreGameSession = asyncHandler(async (req, res) => {
  const session = await GameSession.findOne({ _id: req.params.id, isDeleted: true }).populate("gameId");
  if (!session) return response(res, 404, "Deleted CrossZero session not found");

  const game = session.gameId;
  if (!game || game.type !== "xo") return response(res, 404, "Game not found or not CrossZero");

  await session.restore();

  const playerIds = session.players.map((p) => p.playerId);
  const players = await Player.find({ _id: { $in: playerIds }, isDeleted: true });
  for (const player of players) await player.restore();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero session and players restored");
});

exports.permanentDeleteGameSession = asyncHandler(async (req, res) => {
  const session = await GameSession.findOne({ _id: req.params.id, isDeleted: true }).populate("gameId");
  if (!session) return response(res, 404, "Deleted CrossZero session not found");

  const game = session.gameId;
  if (!game || game.type !== "xo") return response(res, 404, "Game not found or not CrossZero");

  const playerIds = session.players.map((p) => p.playerId);
  if (playerIds.length) await Player.deleteMany({ _id: { $in: playerIds } });
  await session.deleteOne();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero session permanently deleted");
});

exports.restoreAllGameSessions = asyncHandler(async (req, res) => {
  const sessions = await GameSession.aggregate([
    { $match: { isDeleted: true } },
    { $lookup: { from: "games", localField: "gameId", foreignField: "_id", as: "game" } },
    { $unwind: "$game" },
    { $match: { "game.type": "xo" } },
  ]);

  if (!sessions.length) return response(res, 404, "No deleted CrossZero sessions found");

  for (const sessionData of sessions) {
    const session = await GameSession.findById(sessionData._id);
    if (!session) continue;
    await session.restore();
    const playerIds = sessionData.players.map((p) => p.playerId);
    if (playerIds.length) {
      await Player.updateMany(
        { _id: { $in: playerIds }, isDeleted: true },
        { $set: { isDeleted: false, deletedAt: null } }
      );
    }
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${sessions.length} CrossZero session(s)`);
});

exports.permanentDeleteAllGameSessions = asyncHandler(async (req, res) => {
  const sessions = await GameSession.aggregate([
    { $match: { isDeleted: true } },
    { $lookup: { from: "games", localField: "gameId", foreignField: "_id", as: "game" } },
    { $unwind: "$game" },
    { $match: { "game.type": "xo" } },
  ]);

  if (!sessions.length) return response(res, 404, "No deleted CrossZero sessions found");

  for (const sessionData of sessions) {
    const playerIds = sessionData.players.map((p) => p.playerId);
    if (playerIds.length) await Player.deleteMany({ _id: { $in: playerIds } });
    await GameSession.deleteOne({ _id: sessionData._id });
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Permanently deleted ${sessions.length} CrossZero session(s)`);
});

exports.exportResults = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    slug: req.params.gameSlug,
    ...CZ_FILTER,
  }).populate("businessId", "name");
  if (!game) return response(res, 404, "CrossZero PvP game not found");

  const sessions = await GameSession.find({
    gameId: game._id,
    status: "completed",
  }).populate("players.playerId winner");

  if (!sessions.length) {
    return response(res, 404, "No completed sessions to export");
  }

  const metadataRows = buildMetadataRows(game, "CrossZero PvP", sessions.length, [
    ["Player 1 Mark", "X"],
    ["Player 2 Mark", "O"],
  ]);

  const headers = [
    "Sr. No.",
    "Session ID",
    "Player 1 Name",
    "Player 1 Company",
    "Player 1 Department",
    "Player 1 Mark",
    "Player 2 Name",
    "Player 2 Company",
    "Player 2 Department",
    "Player 2 Mark",
    "Outcome",
    "Winner",
    "Total Moves",
    "Time Taken (s)",
    "Started At",
    "Completed At",
  ];

  const dataRows = sessions.map((session, index) => {
    const p1 = session.players.find((player) => player.playerType === "p1");
    const p2 = session.players.find((player) => player.playerType === "p2");
    const winnerName = session.winner ? session.winner.name || "Unknown" : "Draw";

    return [
      index + 1,
      session._id.toString(),
      p1?.playerId?.name || "-",
      p1?.playerId?.company || "-",
      p1?.playerId?.department || "-",
      "X",
      p2?.playerId?.name || "-",
      p2?.playerId?.company || "-",
      p2?.playerId?.department || "-",
      "O",
      getPvpOutcomeLabel(session.xoStats?.result),
      winnerName,
      session.xoStats?.moves || 0,
      session.xoStats?.timeTaken || 0,
      formatDateTime(session.startTime),
      formatDateTime(session.endTime),
    ];
  });

  const worksheet = buildWorksheet(metadataRows, headers, dataRows, [
    10,
    28,
    22,
    22,
    20,
    14,
    22,
    22,
    20,
    14,
    20,
    22,
    12,
    14,
    22,
    22,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

  const safe = (value) => value.replace(/[^\w\u0600-\u06FF-]/g, "_");
  const filename = `${safe(game.businessId?.name || "Business")}-${safe(
    game.title
  )}-CrossZero-Results.xlsx`;

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
