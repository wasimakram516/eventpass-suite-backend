const Game = require("../../models/Game");
const Business = require("../../models/Business");
const Player = require("../../models/Player");
const Team = require("../../models/Team");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const GameSession = require("../../models/GameSession");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// CREATE GAME (PvP / Team Mode)
exports.createGame = asyncHandler(async (req, res) => {
  const {
    businessSlug,
    title,
    slug,
    choicesCount,
    countdownTimer,
    gameSessionTimer,
    isTeamMode,
    maxTeams,
    playersPerTeam,
    teamNames,
  } = req.body;

  if (!businessSlug || !title || !slug || !choicesCount || !gameSessionTimer) {
    return response(res, 400, "Missing required fields");
  }

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
  const businessId = business._id;

  const teamMode = isTeamMode === "true" || isTeamMode === true;
  const parsedMaxTeams = parseInt(maxTeams, 10) || 2;
  const parsedPlayersPerTeam = parseInt(playersPerTeam, 10) || 2;

  let coverImage = "",
    nameImage = "",
    backgroundImage = "";

  if (req.files?.cover) {
    const uploaded = await uploadToS3(req.files.cover[0], business.slug, "EventDuel", {
      inline: true,
    });
    coverImage = uploaded.fileUrl;
  }
  if (req.files?.name) {
    const uploaded = await uploadToS3(req.files.name[0], business.slug, "EventDuel", {
      inline: true,
    });
    nameImage = uploaded.fileUrl;
  }
  if (req.files?.background) {
    const uploaded = await uploadToS3(req.files.background[0], business.slug, "EventDuel", {
      inline: true,
    });
    backgroundImage = uploaded.fileUrl;
  }

  const game = await Game.create({
    businessId,
    title,
    slug: sanitizedSlug,
    coverImage,
    nameImage,
    backgroundImage,
    choicesCount: Number(choicesCount),
    countdownTimer: Number(countdownTimer) || 3,
    gameSessionTimer: Number(gameSessionTimer),
    mode: "pvp",
    type: "quiz",
    isTeamMode: teamMode,
    maxTeams: parsedMaxTeams,
    playersPerTeam: parsedPlayersPerTeam,
    teams: [],
  });

  // Create teams if team mode enabled
  if (teamMode && Array.isArray(teamNames) && teamNames.length > 0) {
    const validNames = teamNames.filter((name) => name && name.trim());
    const newTeams = await Team.insertMany(
      validNames.map((name) => ({
        name: name.trim(),
        gameId: game._id,
      }))
    );
    game.teams = newTeams.map((t) => t._id);
    await game.save();
  }

  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populatedGame = await Game.findById(game._id)
    .populate("teams", "name")
    .populate("businessId", "name");

  return response(
    res,
    201,
    teamMode ? "Team PvP game created" : "PvP game created",
    populatedGame
  );
});

// UPDATE GAME (PvP / Team Mode)
exports.updateGame = asyncHandler(async (req, res) => {
  const game = await Game.findById({
    _id: req.params.id,
    mode: "pvp",
    type: "quiz",
  }).populate("teams");
  
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

  const {
    title,
    slug,
    choicesCount,
    countdownTimer,
    gameSessionTimer,
    isTeamMode,
    maxTeams,
    playersPerTeam,
    teamNames,
  } = req.body;

  const teamMode = isTeamMode === "true" || isTeamMode === true;
  const parsedMaxTeams = parseInt(maxTeams, 10) || game.maxTeams;
  const parsedPlayersPerTeam =
    parseInt(playersPerTeam, 10) || game.playersPerTeam;

  if (slug && slug !== game.slug) {
    const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
    game.slug = sanitizedSlug;
  }

  game.title = title || game.title;
  game.choicesCount = Number(choicesCount) || game.choicesCount;
  game.countdownTimer = Number(countdownTimer) || game.countdownTimer;
  game.gameSessionTimer = Number(gameSessionTimer) || game.gameSessionTimer;
  game.isTeamMode = teamMode;
  game.maxTeams = parsedMaxTeams;
  game.playersPerTeam = parsedPlayersPerTeam;

  // Team handling
  if (teamMode && Array.isArray(teamNames)) {
    const existingTeams = game.teams || [];

    // Update existing team names
    for (let i = 0; i < Math.min(existingTeams.length, teamNames.length); i++) {
      if (existingTeams[i].name !== teamNames[i]) {
        existingTeams[i].name = teamNames[i].trim();
        await existingTeams[i].save();
      }
    }

    // Add new teams if count increased
    if (teamNames.length > existingTeams.length) {
      const toAdd = teamNames.slice(existingTeams.length);
      const newTeams = await Team.insertMany(
        toAdd.map((name) => ({
          name: name.trim(),
          gameId: game._id,
        }))
      );
      game.teams.push(...newTeams.map((t) => t._id));
    }

    // Remove extra teams if count decreased
    if (teamNames.length < existingTeams.length) {
      const toRemove = existingTeams.slice(teamNames.length);
      await Team.deleteMany({ _id: { $in: toRemove.map((t) => t._id) } });
      game.teams = existingTeams.slice(0, teamNames.length).map((t) => t._id);
    }
  } else {
    // If team mode disabled → remove all teams
    if (game.teams?.length) {
      await Team.deleteMany({ _id: { $in: game.teams } });
      game.teams = [];
    }
  }

  const business = await Business.findById(game.businessId);
  if (!business) return response(res, 404, "Business not found");

  if (req.files?.cover) {
    if (game.coverImage) await deleteFromS3(game.coverImage);
    const uploaded = await uploadToS3(req.files.cover[0], business.slug, "EventDuel", {
      inline: true,
    });
    game.coverImage = uploaded.fileUrl;
  }

  if (req.files?.name) {
    if (game.nameImage) await deleteFromS3(game.nameImage);
    const uploaded = await uploadToS3(req.files.name[0], business.slug, "EventDuel", {
      inline: true,
    });
    game.nameImage = uploaded.fileUrl;
  }

  if (req.files?.background) {
    if (game.backgroundImage) await deleteFromS3(game.backgroundImage);
    const uploaded = await uploadToS3(req.files.background[0], business.slug, "EventDuel", {
      inline: true,
    });
    game.backgroundImage = uploaded.fileUrl;
  }

  await game.save();

  const populatedGame = await Game.findById(game._id)
    .populate("teams", "name")
    .populate("businessId", "name");

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    teamMode ? "Team PvP Game updated" : "PvP Game updated",
    populatedGame
  );
});

// Get PvP games for a business
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({
    slug: req.params.slug,
  }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({
    businessId: business._id,
    mode: "pvp",
  })
    .populate("teams", "name")
    .notDeleted();
  return response(res, 200, `PvP Games fetched for ${business.name}`, games);
});

// Get PvP game by ID or slug
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id)
    .populate("teams", "name")
    .notDeleted();

  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

  return response(res, 200, "Game found", game);
});

exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ slug: req.params.slug })
    .populate("teams", "name")
    .notDeleted();

  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

  return response(res, 200, "Game found", game);
});

// Delete Game
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

  // check for active sessions
  const sessionsExist = await GameSession.exists({ gameId: game._id });
  if (sessionsExist) {
    return response(res, 400, "Cannot delete game with existing sessions");
  }

  await game.softDelete(req.user.id);

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game moved to recycle bin");
});

// Restore Game
exports.restoreGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, mode: "pvp" });
  if (!game) return response(res, 404, "Game not found in trash");

  const conflict = await Game.findOne({
    _id: { $ne: game._id },
    slug: game.slug,
    isDeleted: false,
  });
  if (conflict)
    return response(res, 409, "Cannot restore: slug already in use");

  await game.restore();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game restored", game);
});

// Permanently delete Game
exports.permanentDeleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, mode: "pvp" });
  if (!game) return response(res, 404, "Game not found in trash");

  if (game.coverImage) await deleteFromS3(game.coverImage);
  if (game.nameImage) await deleteFromS3(game.nameImage);
  if (game.backgroundImage) await deleteFromS3(game.backgroundImage);

  const businessId = game.businessId;

  // Delete sessions, players, and teams
  await cascadePermanentDeleteGame(game._id, game.isTeamMode ? game.teams : []);

  await game.deleteOne();

  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game permanently deleted");
});

// Restore all games
exports.restoreAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted({ mode: "pvp" });
  if (!games.length) {
    return response(res, 404, "No PvP games found in trash to restore");
  }

  for (const game of games) {
    await game.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${games.length} games`);
});

// Permanently delete ALL PvP (and Team) games in trash
exports.permanentDeleteAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted({ mode: "pvp" });
  if (!games.length) {
    return response(res, 404, "No PvP games found in trash to delete");
  }

  for (const game of games) {
    await cascadePermanentDeleteGame(
      game._id,
      game.isTeamMode ? game.teams : []
    );

    if (game.coverImage) await deleteFromS3(game.coverImage);
    if (game.nameImage) await deleteFromS3(game.nameImage);
    if (game.backgroundImage) await deleteFromS3(game.backgroundImage);

    await game.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    "All eligible games permanently deleted (including unused teams)"
  );
});

// Cascade permanent delete everything linked to a game
async function cascadePermanentDeleteGame(gameId, teamIds = []) {
  const sessions = await GameSession.find({ gameId });

  if (sessions.length > 0) {
    // Delete players in individual mode sessions
    const playerIds = sessions.flatMap((s) =>
      (s.players || []).map((p) => p.playerId)
    );

    if (playerIds.length > 0) {
      await Player.deleteMany({ _id: { $in: playerIds } });
    }

    await GameSession.deleteMany({ gameId });
  }

  if (teamIds.length) {
    const stillUsed = await Game.find({
      _id: { $ne: gameId },
      teams: { $in: teamIds },
      isDeleted: false,
    });

    const deletableTeams = teamIds.filter(
      (id) => !stillUsed.some((g) => g.teams.includes(id))
    );

    if (deletableTeams.length) {
      await Team.deleteMany({ _id: { $in: deletableTeams } });
    }
  }
}
