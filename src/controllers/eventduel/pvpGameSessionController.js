const XLSX = require("xlsx");
const moment = require("moment");
const Game = require("../../models/Game");
const GameSession = require("../../models/GameSession");
const Player = require("../../models/Player");
const Team = require("../../models/Team");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { emitToRoom } = require("../../utils/socketUtils");
const { emitPvpSessionWithQuestions } = require("../../utils/pvpUtils");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// Get all sessions for a specific game by slug (PvP + Team)
exports.getGameSessions = asyncHandler(async (req, res) => {
  const { gameSlug, page = 1, limit = 5 } = req.query;

  if (!gameSlug) return response(res, 400, "Missing gameSlug in query");

  const game = await Game.findOne({ slug: gameSlug }).notDeleted();
  if (!game) return response(res, 404, "Game not found");

  const pageNumber = parseInt(page);
  const pageSize = parseInt(limit);
  const skip = (pageNumber - 1) * pageSize;

  const totalCount = await GameSession.countDocuments({
    gameId: game._id,
    status: "completed",
  }).notDeleted();

  // ────────────────────────────────
  // 🔹 INDIVIDUAL / PVP MODE
  // ────────────────────────────────
  if (!game.isTeamMode) {
    const sessions = await GameSession.find({
      gameId: game._id,
      status: "completed",
    })
      .notDeleted()
      .populate([
        { path: "players.playerId", select: "name company" },
        { path: "winner", select: "name company" },
        { path: "gameId", select: "title slug isTeamMode mode" },
      ])
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize);

    return response(res, 200, "PvP sessions retrieved", {
      sessions,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      currentPage: pageNumber,
    });
  }

  // ────────────────────────────────
  // 🔹 TEAM MODE
  // ────────────────────────────────
  const sessions = await GameSession.find({
    gameId: game._id,
    status: "completed",
  })
    .notDeleted()
    .populate([
      { path: "teams.teamId", select: "name gameId" },
      { path: "teams.players.playerId", select: "name company" },
      { path: "winnerTeamId", select: "name" },
      { path: "gameId", select: "title slug isTeamMode mode" },
    ])
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize);

  // 🧠 Reshape teams slightly for frontend readability
  const formattedSessions = sessions.map((s) => ({
    _id: s._id,
    createdAt: s.createdAt,
    status: s.status,
    gameId: s.gameId,
    winnerTeamId: s.winnerTeamId,
    teams: (s.teams || []).map((t) => ({
      teamId: t.teamId?._id,
      teamName: t.teamId?.name || "Unnamed Team",
      totalScore: t.totalScore ?? 0,
      avgTimeTaken: t.avgTimeTaken ?? 0,
      avgAttemptedQuestions: t.avgAttemptedQuestions ?? 0,
      players: (t.players || []).map((p) => ({
        playerId: p.playerId?._id,
        name: p.playerId?.name || "Unknown",
        company: p.playerId?.company || "N/A",
        score: p.score ?? 0,
        timeTaken: p.timeTaken ?? 0,
        attemptedQuestions: p.attemptedQuestions ?? 0,
      })),
    })),
  }));

  return response(res, 200, "Team sessions retrieved", {
    sessions: formattedSessions,
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

  const game = await Game.findOne({ slug: gameSlug }).notDeleted();
  if (!game || game.mode !== "pvp") {
    return response(res, 404, "Game not found");
  }

  const gameId = game._id;

  // Prevent multiple active/pending sessions for same game
  const existing = await GameSession.findOne({
    gameId,
    status: { $in: ["pending", "active"] },
  });
  if (existing)
    return response(res, 400, "Session already in progress for this game.");

  // --- PvP Mode ---
  if (!game.isTeamMode) {
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
  }

  // --- Team Mode ---
  const validTeams = await Team.find({ _id: { $in: game.teams }, gameId });
  if (!validTeams.length) {
    return response(res, 400, "No valid teams found for this game.");
  }

  const teams = validTeams.map((team) => ({
    teamId: team._id,
    totalScore: 0,
    avgTimeTaken: 0,
    avgAttemptedQuestions: 0,
  }));

  const questionsAssigned = {
    Teams: validTeams.map((team) => ({
      teamId: team._id,
      questionIndexes: [],
    })),
  };

  const session = await GameSession.create({
    gameId,
    teams,
    questionsAssigned,
    status: "pending",
  });

  const populatedSession = await GameSession.findById(session._id).populate([
    { path: "teams.teamId" },
    { path: "gameId" },
  ]);

  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  return response(res, 201, "New Team Mode session started", session);
});

// Join session
exports.joinGameSession = asyncHandler(async (req, res) => {
  const { gameSlug, name, company, playerType, teamId } = req.body;

  if (!gameSlug || !name) {
    return response(res, 400, "Missing required fields: gameSlug or name");
  }

  const game = await Game.findOne({ slug: gameSlug }).notDeleted();
  if (!game || game.mode !== "pvp") {
    return response(res, 400, "Invalid or non-PvP game.");
  }

  const session = await GameSession.findOne({
    gameId: game._id,
    status: "pending",
  });
  if (!session) return response(res, 404, "No pending session for this game.");

  // --- PvP Mode (1v1) ---
  if (!game.isTeamMode) {
    if (!playerType || !["p1", "p2"].includes(playerType)) {
      return response(res, 400, "Invalid playerType. Use 'p1' or 'p2'.");
    }

    const slotTaken = session.players.some((p) => p.playerType === playerType);
    if (slotTaken) {
      return response(res, 400, `Slot ${playerType} already taken.`);
    }

    const player = await Player.create({
      name,
      company,
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

    const allSessions = await GameSession.find({ gameId: session.gameId })
      .notDeleted()
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
  }

  // --- Team Mode (multi-team) ---
  if (!teamId) {
    return response(res, 400, "Missing teamId for team-based game.");
  }

  const team = await Team.findById(teamId);
  if (!team) return response(res, 404, "Team not found.");

  // Ensure team belongs to current game
  if (!team.gameId.equals(game._id)) {
    return response(res, 400, "Selected team does not belong to this game.");
  }

  let teamSlot = session.teams.find((t) => t.teamId.equals(team._id));

  if (!teamSlot) {
    teamSlot = {
      teamId: team._id,
      players: [],
      totalScore: 0,
      avgTimeTaken: 0,
      avgAttemptedQuestions: 0,
    };
    session.teams.push(teamSlot);
  }

  if (teamSlot.players.length >= game.playersPerTeam) {
    return response(
      res,
      400,
      `Team "${team.name}" is already full (${game.playersPerTeam} players).`
    );
  }

  const player = await Player.create({
    name,
    company,
    sessionId: session._id,
  });

  teamSlot.players.push({
    playerId: player._id,
    score: 0,
    timeTaken: 0,
    attemptedQuestions: 0,
  });

  await session.save();

  const allSessions = await GameSession.find({ gameId: session.gameId })
    .notDeleted()
    .populate([
      { path: "teams.teamId" },
      { path: "teams.players.playerId" },
      { path: "winnerTeamId" },
      { path: "gameId" },
    ])
    .sort({ createdAt: -1 })
    .limit(5);

  emitToRoom(game.slug, "pvpAllSessions", allSessions);

  const populatedSession = await GameSession.findById(session._id).populate([
    { path: "teams.teamId" },
    { path: "teams.players.playerId" },
    { path: "winnerTeamId" },
    { path: "gameId" },
  ]);

  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  return response(res, 201, `${name} joined ${team.name}`, {
    player,
    team,
    session: populatedSession,
  });
});

// Abandon a session if players or teams don’t join within a certain time
exports.abandonGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  if (session.status !== "pending") {
    return response(res, 400, "Only pending sessions can be abandoned");
  }

  // Load the game to check mode
  const game = await Game.findById(session.gameId).notDeleted();
  if (!game) return response(res, 404, "Game not found");

  // --- PvP Mode ---
  if (!game.isTeamMode) {
    session.status = "abandoned";
    session.endTime = new Date();
    await session.save();

    const populatedSession = await GameSession.findById(session._id).populate(
      "players.playerId winner gameId"
    );

    emitToRoom(game.slug, "pvpCurrentSession", populatedSession);
    return response(res, 200, "Session abandoned", populatedSession);
  }

  // --- Team Mode ---
  session.status = "abandoned";
  session.endTime = new Date();
  await session.save();

  const populatedSession = await GameSession.findById(session._id).populate([
    { path: "teams.teamId" },
    { path: "teams.players.playerId" },
    { path: "winnerTeamId" },
    { path: "gameId" },
  ]);

  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  return response(res, 200, "Team-based session abandoned", populatedSession);
});

// Activate session
exports.activateGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  // Fetch session and associated game
  let session = await GameSession.findById(sessionId)
    .populate("gameId")
    .populate("teams.teamId")
    .populate("teams.players.playerId");

  if (!session) return response(res, 404, "Session not found");

  const game = session.gameId;
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid PvP game");

  // --- PvP Mode ---
  if (!game.isTeamMode) {
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
  }

  // --- Team Mode ---
  if (!session.teams || session.teams.length === 0)
    return response(res, 400, "No teams found in this session");

  // Check if all session teams have required players
  const unreadyTeams = session.teams.filter(
    (t) => (t.players?.length || 0) < game.playersPerTeam
  );

  if (unreadyTeams.length > 0) {
    const names = unreadyTeams
      .map((t) => t.teamId?.name || "Unnamed Team")
      .join(", ");
    return response(
      res,
      400,
      `Teams not ready: ${names}. Each team requires ${game.playersPerTeam} players.`
    );
  }

  // All teams ready → activate session
  await emitPvpSessionWithQuestions(
    session,
    game,
    emitToRoom,
    "pvpCurrentSession",
    GameSession
  );

  return response(res, 200, "Team-based session activated", session);
});

// Submit result for a player or team
exports.submitPvPResult = asyncHandler(async (req, res) => {
  const { sessionId, playerId } = req.params;
  const { score, timeTaken, attemptedQuestions, teamId } = req.body;

  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  const game = await Game.findById(session.gameId);
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid or non-PvP game.");

  // ────────────────────────────────
  // PVP (1v1) MODE
  // ────────────────────────────────
  if (!game.isTeamMode) {
    const playerStats = session.players.find(
      (p) => p.playerId.toString() === playerId
    );
    if (!playerStats) return response(res, 404, "Player not in session");

    playerStats.score = score;
    playerStats.timeTaken = timeTaken;
    playerStats.attemptedQuestions = attemptedQuestions;
    await session.save();

    const totalQ = game.questions.length;
    const duration = game.gameSessionTimer || 60;
    const [p1, p2] = session.players;
    const p1Final =
      (p1?.attemptedQuestions ?? 0) >= totalQ ||
      (p1?.timeTaken ?? 0) >= duration;
    const p2Final =
      (p2?.attemptedQuestions ?? 0) >= totalQ ||
      (p2?.timeTaken ?? 0) >= duration;

    const bothFinalized = p1Final && p2Final;

    if (session.status === "active" && bothFinalized) {
      let winner = null;
      if ((p1.score ?? 0) > (p2.score ?? 0)) winner = p1.playerId;
      else if ((p2.score ?? 0) > (p1.score ?? 0)) winner = p2.playerId;
      else {
        const t1 = p1.timeTaken ?? duration;
        const t2 = p2.timeTaken ?? duration;
        if (t1 < t2) winner = p1.playerId;
        else if (t2 < t1) winner = p2.playerId;
      }

      session.winner = winner;
      session.status = "completed";
      session.endTime = new Date();
      await session.save();

      const allSessions = await GameSession.find({ gameId: session.gameId })
        .notDeleted()
        .populate("players.playerId winner gameId")
        .sort({ createdAt: -1 })
        .limit(5);
      emitToRoom(game.slug, "pvpAllSessions", allSessions);

      const populatedSession = await GameSession.findById(session._id).populate(
        "players.playerId winner gameId"
      );
      emitToRoom(game.slug, "pvpCurrentSession", populatedSession);
    } else {
      const mapIndexesToQuestions = (indexes) =>
        (indexes || []).map((i) => game.questions[i]);

      const populatedSession = await GameSession.findById(session._id).populate(
        "players.playerId winner gameId"
      );

      emitToRoom(game.slug, "pvpCurrentSession", {
        populatedSession,
        player1Questions: mapIndexesToQuestions(
          session.questionsAssigned.Player1
        ),
        player2Questions: mapIndexesToQuestions(
          session.questionsAssigned.Player2
        ),
      });
    }

    recomputeAndEmit(game.businessId || null).catch((err) =>
      console.error("Background recompute failed:", err.message)
    );
    return response(res, 200, "Player result saved", playerStats);
  }

  // ────────────────────────────────
  // TEAM MODE
  // ────────────────────────────────
  if (!teamId)
    return response(
      res,
      400,
      "Missing teamId for team-based result submission"
    );

  const teamEntry = session.teams.find((t) => t.teamId.toString() === teamId);
  if (!teamEntry) return response(res, 404, "Team not found in session");

  const playerStats = teamEntry.players.find(
    (p) => p.playerId.toString() === playerId
  );
  if (!playerStats) return response(res, 404, "Player not found in team");

  // update player stats
  playerStats.score = score;
  playerStats.timeTaken = timeTaken;
  playerStats.attemptedQuestions = attemptedQuestions;

  // recompute team aggregates
  const allPlayers = teamEntry.players || [];
  const totalScore = allPlayers.reduce((s, p) => s + (p.score || 0), 0);
  const totalTime = allPlayers.reduce((s, p) => s + (p.timeTaken || 0), 0);
  const totalAttempted = allPlayers.reduce(
    (s, p) => s + (p.attemptedQuestions || 0),
    0
  );
  const playerCount = allPlayers.length || 1;

  teamEntry.totalScore = totalScore;
  teamEntry.avgTimeTaken = +(totalTime / playerCount).toFixed(3);
  teamEntry.avgAttemptedQuestions = +(totalAttempted / playerCount).toFixed(3);

  await session.save();

  const totalQuestions = game.questions.length;
  const allTeamsDone = session.teams.every((team) =>
    (team.players || []).every(
      (p) => (p.attemptedQuestions || 0) >= totalQuestions
    )
  );

  // finalize if all teams done
  if (session.status === "active" && allTeamsDone) {
    const sortedTeams = [...session.teams].sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.avgTimeTaken - b.avgTimeTaken;
    });

    session.winnerTeamId = sortedTeams[0]?.teamId || null;
    session.status = "completed";
    session.endTime = new Date();
    await session.save();

    // emit final results
    const allSessions = await GameSession.find({ gameId: session.gameId })
      .notDeleted()
      .populate([
        { path: "teams.teamId" },
        { path: "teams.players.playerId" },
        { path: "winnerTeamId" },
        { path: "gameId" },
      ])
      .sort({ createdAt: -1 })
      .limit(5);

    const populatedSession = await GameSession.findById(session._id).populate([
      { path: "teams.teamId" },
      { path: "teams.players.playerId" },
      { path: "winnerTeamId" },
      { path: "gameId" },
    ]);

    const mapIndexesToQuestions = (indexes) =>
      (indexes || []).map((i) => game.questions[i]);
    const teamQuestions = (session.questionsAssigned?.Teams || []).map((t) => ({
      teamId: t.teamId,
      questionSet: mapIndexesToQuestions(t.questionIndexes),
    }));

    emitToRoom(game.slug, "pvpCurrentSession", {
      populatedSession,
      teamQuestions,
    });
    emitToRoom(game.slug, "pvpAllSessions", allSessions);
  } else {
    // emit progress update (not completed yet)
    const populatedSession = await GameSession.findById(session._id).populate([
      { path: "teams.teamId" },
      { path: "teams.players.playerId" },
      { path: "winnerTeamId" },
      { path: "gameId" },
    ]);

    const mapIndexesToQuestions = (indexes) =>
      (indexes || []).map((i) => game.questions[i]);
    const teamQuestions = (session.questionsAssigned?.Teams || []).map((t) => ({
      teamId: t.teamId,
      questionSet: mapIndexesToQuestions(t.questionIndexes),
    }));

    emitToRoom(game.slug, "pvpCurrentSession", {
      populatedSession,
      teamQuestions,
    });
  }

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Team result saved", teamEntry);
});

// End session & decide winner
exports.endGameSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const session = await GameSession.findById(sessionId);
  if (!session) return response(res, 404, "Session not found");

  const game = await Game.findById(session.gameId);
  if (!game || game.mode !== "pvp")
    return response(res, 400, "Invalid or non-PvP game.");

  // Wait briefly to allow last updates
  emitToRoom(game.slug, "forceSubmitPvP", { sessionId });
  await new Promise((r) => setTimeout(r, 500));

  // --- PvP MODE ---
  if (!game.isTeamMode) {
    const [p1, p2] = session.players;
    let winner = null;

    if (p1?.score > p2?.score) winner = p1.playerId;
    else if (p2?.score > p1?.score) winner = p2.playerId;
    else {
      if (p1?.timeTaken < p2?.timeTaken) winner = p1.playerId;
      else if (p2?.timeTaken < p1?.timeTaken) winner = p2.playerId;
      else winner = null; // exact tie
    }

    session.winner = winner;
    session.status = "completed";
    session.endTime = new Date();
    await session.save();

    const populatedSession = await GameSession.findById(session._id).populate(
      "players.playerId winner gameId"
    );

    emitToRoom(game.slug, "pvpCurrentSession", populatedSession);
    return response(res, 200, "Session completed", populatedSession);
  }

  // --- TEAM MODE ---
  if (!session.teams?.length)
    return response(res, 400, "No teams found in this session");

  // Graceful fallback if no team data or all scores zero
  const meaningfulTeams = session.teams.filter(
    (t) =>
      t.totalScore > 0 ||
      t.avgAttemptedQuestions > 0 ||
      (t.players && t.players.some((p) => p.score > 0))
  );

  if (meaningfulTeams.length === 0) {
    session.winnerTeamId = null;
    session.status = "completed";
    session.endTime = new Date();
    await session.save();

    const populatedSession = await GameSession.findById(session._id).populate([
      { path: "teams.teamId" },
      { path: "teams.players.playerId" },
      { path: "gameId" },
    ]);

    emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

    return response(
      res,
      200,
      "Session completed — no meaningful results recorded, declared a tie.",
      populatedSession
    );
  }

  // Sort by totalScore DESC, avgTimeTaken ASC
  const sortedTeams = [...session.teams].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.avgTimeTaken - b.avgTimeTaken;
  });

  const top = sortedTeams[0];
  const second = sortedTeams[1];
  let winnerTeamId = null;

  if (!second) {
    winnerTeamId = top.teamId;
  } else if (top.totalScore === second.totalScore) {
    if (top.avgTimeTaken < second.avgTimeTaken) winnerTeamId = top.teamId;
    else if (top.avgTimeTaken > second.avgTimeTaken)
      winnerTeamId = second.teamId;
    else winnerTeamId = null; // Perfect tie
  } else {
    winnerTeamId = top.teamId;
  }

  session.winnerTeamId = winnerTeamId;
  session.status = "completed";
  session.endTime = new Date();
  await session.save();

  const populatedSession = await GameSession.findById(session._id).populate([
    { path: "teams.teamId" },
    { path: "teams.players.playerId" },
    { path: "winnerTeamId" },
    { path: "gameId" },
  ]);

  emitToRoom(game.slug, "pvpCurrentSession", populatedSession);

  if (!winnerTeamId) {
    return response(
      res,
      200,
      "Session completed — it's a tie!",
      populatedSession
    );
  }

  const winningTeamName =
    populatedSession.teams.find(
      (t) => t.teamId._id.toString() === winnerTeamId.toString()
    )?.teamId?.name || "Unknown Team";

  return response(
    res,
    200,
    `Team-based session completed — Winner: ${winningTeamName}`,
    populatedSession
  );
});

// Soft reset all sessions for a given gameSlug
exports.resetGameSessions = asyncHandler(async (req, res) => {
  const { gameSlug } = req.body;
  if (!gameSlug) return response(res, 400, "Missing gameSlug in request body");

  const game = await Game.findOne({ slug: gameSlug });
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

  const sessions = await GameSession.find({ gameId: game._id });
  if (!sessions.length)
    return response(res, 404, "No sessions found for this game");

  // --- PvP Mode ---
  if (!game.isTeamMode) {
    const allPlayerIds = sessions.flatMap((s) =>
      s.players.map((p) => p.playerId)
    );

    for (const session of sessions) {
      await session.softDelete(req.user.id);
    }

    const players = await Player.find({ _id: { $in: allPlayerIds } });
    for (const player of players) {
      await player.softDelete(req.user.id);
    }
  } else {
    // --- Team Mode ---
    const allTeamIds = sessions.flatMap((s) => s.teams.map((t) => t.teamId));
    const allPlayerIds = sessions.flatMap((s) =>
      s.teams.flatMap((t) => t.players.map((p) => p.playerId))
    );

    for (const session of sessions) {
      await session.softDelete(req.user.id);
    }

    // Soft delete nested team players
    if (allPlayerIds.length > 0) {
      const players = await Player.find({ _id: { $in: allPlayerIds } });
      for (const player of players) {
        await player.softDelete(req.user.id);
      }
    }

    // Soft delete teams
    if (allTeamIds.length > 0) {
      const teams = await Team.find({ _id: { $in: allTeamIds } });
      for (const team of teams) {
        await team.softDelete(req.user.id);
      }
    }
  }

  emitToRoom(game.slug, "pvpCurrentSession", null);
  emitToRoom(game.slug, "pvpAllSessions", []);

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    game.isTeamMode
      ? "All team sessions moved to recycle bin"
      : "All PvP sessions moved to recycle bin"
  );
});

// Restore a single game session
exports.restoreGameSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return response(res, 400, "Missing session ID in URL params");

  const session = await GameSession.findOne({
    _id: id,
    isDeleted: true,
  }).populate("gameId");

  if (!session) return response(res, 404, "Deleted session not found");

  const game = session.gameId;
  if (!game || game.mode !== "pvp")
    return response(res, 404, "Game not found or not PvP");

  await session.restore();

  // --- PvP Mode ---
  if (!game.isTeamMode) {
    const playerIds = session.players.map((p) => p.playerId);
    const players = await Player.find({
      _id: { $in: playerIds },
      isDeleted: true,
    });
    for (const player of players) {
      await player.restore();
    }
  } else {
    // --- Team Mode ---
    const teamIds = session.teams.map((t) => t.teamId);
    const allPlayerIds = session.teams.flatMap((t) =>
      t.players.map((p) => p.playerId)
    );

    const teams = await Team.find({ _id: { $in: teamIds }, isDeleted: true });
    for (const team of teams) await team.restore();

    const players = await Player.find({
      _id: { $in: allPlayerIds },
      isDeleted: true,
    });
    for (const player of players) await player.restore();
  }

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    game.isTeamMode
      ? "Team-based game session, teams, and players restored"
      : "Game session and associated players restored"
  );
});

// Restore all game sessions
exports.restoreAllGameSessions = asyncHandler(async (req, res) => {
  const sessions = await GameSession.aggregate([
    { $match: { isDeleted: true } },
    {
      $lookup: {
        from: "games",
        localField: "gameId",
        foreignField: "_id",
        as: "game",
      },
    },
    { $unwind: "$game" },
    { $match: { "game.mode": "pvp" } },
  ]);

  if (!sessions.length)
    return response(res, 404, "No deleted sessions found to restore");

  for (const sessionData of sessions) {
    const session = await GameSession.findById(sessionData._id).populate(
      "gameId"
    );
    const game = session.gameId;
    await session.restore();

    if (!game.isTeamMode) {
      const playerIds = session.players.map((p) => p.playerId);
      const players = await Player.find({
        _id: { $in: playerIds },
        isDeleted: true,
      });
      for (const player of players) await player.restore();
    } else {
      const teamIds = session.teams.map((t) => t.teamId);
      const allPlayerIds = session.teams.flatMap((t) =>
        t.players.map((p) => p.playerId)
      );

      const teams = await Team.find({
        _id: { $in: teamIds },
        isDeleted: true,
      });
      for (const team of teams) await team.restore();

      const players = await Player.find({
        _id: { $in: allPlayerIds },
        isDeleted: true,
      });
      for (const player of players) await player.restore();
    }
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${sessions.length} sessions`);
});

// Permanently delete a single game session
exports.permanentDeleteGameSession = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await GameSession.findOne({
    _id: id,
    isDeleted: true,
  }).populate("gameId", "businessId");

  if (!session) return response(res, 404, "Deleted session not found");

  const game = session.gameId;

  if (!game.isTeamMode) {
    const playerIds = session.players.map((p) => p.playerId);
    if (playerIds.length > 0) {
      await Player.deleteMany({ _id: { $in: playerIds } });
    }
  } else {
    const teamIds = session.teams.map((t) => t.teamId);
    const allPlayerIds = session.teams.flatMap((t) =>
      t.players.map((p) => p.playerId)
    );

    if (allPlayerIds.length > 0) {
      await Player.deleteMany({ _id: { $in: allPlayerIds } });
    }

    if (teamIds.length > 0) {
      await Team.deleteMany({ _id: { $in: teamIds } });
    }
  }

  await GameSession.deleteOne({ _id: id });

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    game.isTeamMode
      ? "Team-based session, teams, and players permanently deleted"
      : "PvP session and associated players permanently deleted"
  );
});

// Permanently delete all game sessions
exports.permanentDeleteAllGameSessions = asyncHandler(async (req, res) => {
  const sessions = await GameSession.aggregate([
    { $match: { isDeleted: true } },
    {
      $lookup: {
        from: "games",
        localField: "gameId",
        foreignField: "_id",
        as: "game",
      },
    },
    { $unwind: "$game" },
    { $match: { "game.mode": "pvp" } },
  ]);

  if (!sessions.length)
    return response(
      res,
      404,
      "No deleted sessions found to delete permanently"
    );

  for (const sessionData of sessions) {
    const session = await GameSession.findById(sessionData._id).populate(
      "gameId"
    );
    const game = session.gameId;

    if (!game.isTeamMode) {
      const playerIds = session.players.map((p) => p.playerId);
      if (playerIds.length > 0)
        await Player.deleteMany({ _id: { $in: playerIds } });
    } else {
      const teamIds = session.teams.map((t) => t.teamId);
      const allPlayerIds = session.teams.flatMap((t) =>
        t.players.map((p) => p.playerId)
      );

      if (allPlayerIds.length > 0)
        await Player.deleteMany({ _id: { $in: allPlayerIds } });
      if (teamIds.length > 0) await Team.deleteMany({ _id: { $in: teamIds } });
    }

    await GameSession.deleteOne({ _id: session._id });
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Permanently deleted ${sessions.length} sessions`);
});

// Export all results (PvP or Team Mode) to Excel
exports.exportResults = asyncHandler(async (req, res) => {
  const gameSlug = req.params.gameSlug;

  const game = await Game.findOne({ slug: gameSlug })
    .populate("businessId", "name")
    .notDeleted();
  if (!game) return response(res, 404, "Game not found");

  const sessions = await GameSession.find({
    gameId: game._id,
    status: "completed",
  })
    .notDeleted()
    .populate(
      game.isTeamMode
        ? [{ path: "teams.teamId" }, { path: "teams.players.playerId" }]
        : "players.playerId"
    );

  if (!sessions.length)
    return response(res, 404, "No completed sessions to export");

  // --- PvP MODE ---
  if (!game.isTeamMode) {
    const allSessionData = sessions.map((session) => {
      const p1 = session.players.find((p) => p.playerType === "p1");
      const p2 = session.players.find((p) => p.playerType === "p2");

      return {
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
      };
    });

    const summary = [
      ["Game Title", game.title],
      ["Business Name", game.businessId.name],
      ["Total PvP Sessions", sessions.length],
      ["Exported At", moment().format("YYYY-MM-DD hh:mm A")],
      [],
    ];

    const sheet = XLSX.utils.aoa_to_sheet(summary);
    XLSX.utils.sheet_add_json(sheet, allSessionData, { origin: -1 });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "PvP Results");

    const sanitize = (n) => n.replace(/[^\w\u0600-\u06FF-]/g, "_");
    const filename = `${sanitize(game.businessId.name)}-${sanitize(
      game.title
    )}-results.xlsx`;

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
  }

  // --- TEAM MODE ---
  const allTeamData = sessions
    .map((session) => {
      return session.teams.map((t) => {
        const teamPlayers = (t.players || []).map((p) => ({
          name: p.playerId?.name || "Unknown",
          company: p.playerId?.company || "-",
          score: p.score ?? "-",
          time: p.timeTaken ?? "-",
          attempted: p.attemptedQuestions ?? "-",
        }));

        return {
          "Session ID": session._id.toString(),
          "Submitted At": moment(session.updatedAt).format(
            "YYYY-MM-DD hh:mm A"
          ),
          "Team Name": t.teamId?.name || "Unknown",
          "Total Score": t.totalScore ?? "-",
          "Average Time (sec)": t.avgTimeTaken ?? "-",
          "Average Attempted": t.avgAttemptedQuestions ?? "-",
          Players: teamPlayers
            .map(
              (p) =>
                `${p.name} (${p.company}) - Score: ${p.score}, Time: ${p.time}, Attempted: ${p.attempted}`
            )
            .join("; "),
        };
      });
    })
    .flat();

  const summary = [
    ["Game Title", game.title],
    ["Business Name", game.businessId.name],
    ["Total Team Sessions", sessions.length],
    ["Exported At", moment().format("YYYY-MM-DD hh:mm A")],
    [],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.sheet_add_json(sheet, allTeamData, { origin: -1 });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Team Results");

  const sanitize = (n) => n.replace(/[^\w\u0600-\u06FF-]/g, "_");
  const filename = `${sanitize(game.businessId.name)}-${sanitize(
    game.title
  )}-team-results.xlsx`;

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

// Get leaderboard for a game (PvP or Team Mode)
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const gameSlug = req.params.gameSlug;

  const game = await Game.findOne({ slug: gameSlug }).notDeleted();
  if (!game) return response(res, 404, "Game not found");
  if (game.mode !== "pvp")
    return response(res, 400, "Leaderboard only available for PvP games");

  // --- PvP MODE ---
  if (!game.isTeamMode) {
    const sessions = await GameSession.find({
      gameId: game._id,
      status: "completed",
    })
      .notDeleted()
      .populate("players.playerId");

    const results = sessions.flatMap((session) =>
      session.players.map((p) => ({
        name: p.playerId?.name || "Unknown",
        company: p.playerId?.company || "-",
        score: p.score ?? 0,
        timeTaken: p.timeTaken ?? 0,
        attemptedQuestions: p.attemptedQuestions ?? 0,
        sessionId: session._id,
        endTime: session.endTime,
      }))
    );

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.timeTaken - b.timeTaken;
    });

    return response(res, 200, "Leaderboard", results);
  }

  // --- TEAM MODE ---
  const sessions = await GameSession.find({
    gameId: game._id,
    status: "completed",
  })
    .notDeleted()
    .populate([{ path: "teams.teamId" }, { path: "teams.players.playerId" }]);

  const results = sessions.flatMap((session) =>
    session.teams.map((t) => ({
      teamName: t.teamId?.name || "Unknown",
      totalScore: t.totalScore ?? 0,
      avgTimeTaken: t.avgTimeTaken ?? 0,
      avgAttemptedQuestions: t.avgAttemptedQuestions ?? 0,
      players: (t.players || []).map((p) => ({
        name: p.playerId?.name || "Unknown",
        company: p.playerId?.company || "-",
        score: p.score ?? 0,
        timeTaken: p.timeTaken ?? 0,
        attempted: p.attemptedQuestions ?? 0,
      })),
      sessionId: session._id,
      endTime: session.endTime,
    }))
  );

  // Sort: totalScore DESC, avgTimeTaken ASC
  results.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.avgTimeTaken - b.avgTimeTaken;
  });

  return response(res, 200, "Team Leaderboard", results);
});
