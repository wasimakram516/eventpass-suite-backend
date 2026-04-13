const Game = require("../../models/Game");
const Business = require("../../models/Business");
const GameSession = require("../../models/GameSession");
const Player = require("../../models/Player");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

const CZ_FILTER = { type: "xo" };

// CREATE GAME
exports.createGame = asyncHandler(async (req, res) => {
  const {
    businessSlug,
    title,
    slug,
    mode,
    moveTimer,
    pvpScreenMode,
    coverImage,
    nameImage,
    backgroundImage,
    xImage,
    oImage,
  } = req.body;

  if (!businessSlug || !title || !slug || !mode) {
    return response(res, 400, "Missing required fields: businessSlug, title, slug, mode");
  }

  if (!["solo", "pvp"].includes(mode)) {
    return response(res, 400, "mode must be 'solo' (AI) or 'pvp' (2-player)");
  }

  const missingMedia = [];
  if (!coverImage) missingMedia.push("Cover Image");
  if (!nameImage) missingMedia.push("Name Image");
  if (!backgroundImage) missingMedia.push("Background Image");
  if (missingMedia.length) {
    return response(res, 400, `Missing required media: ${missingMedia.join(", ")}`);
  }

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);

  const game = await Game.createWithAuditUser(
    {
      businessId: business._id,
      title,
      slug: sanitizedSlug,
      coverImage,
      nameImage,
      backgroundImage,
      type: "xo",
      mode,
      moveTimer: Number(moveTimer) || 0,
      gameSessionTimer: 0,
      pvpScreenMode: mode === "pvp" && pvpScreenMode === "single" ? "single" : "dual",
      xImage: xImage || null,
      oImage: oImage || null,
    },
    req.user
  );

  recomputeAndEmit(business._id).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Game.findById(game._id)
    .populate("businessId", "name")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  return response(res, 201, "CrossZero game created", populated);
});

// UPDATE GAME
exports.updateGame = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ _id: req.params.id, ...CZ_FILTER });
  if (!game) return response(res, 404, "CrossZero game not found");

  const { title, slug, mode, moveTimer, pvpScreenMode, coverImage, nameImage, backgroundImage, xImage, oImage } = req.body;

  if (slug && slug !== game.slug) {
    game.slug = await generateUniqueSlug(Game, "slug", slug);
  }
  if (title) game.title = title;
  if (mode && ["solo", "pvp"].includes(mode)) game.mode = mode;
  if (moveTimer !== undefined) game.moveTimer = Number(moveTimer) || 0;
  if (pvpScreenMode && ["single", "dual"].includes(pvpScreenMode)) game.pvpScreenMode = pvpScreenMode;

  for (const [field, val] of [
    ["coverImage", coverImage],
    ["nameImage", nameImage],
    ["backgroundImage", backgroundImage],
    ["xImage", xImage],
    ["oImage", oImage],
  ]) {
    if (val !== undefined) {
      if (val && val !== game[field]) {
        if (game[field]) await deleteFromS3(game[field]);
        game[field] = val;
      } else if (val === null && game[field]) {
        await deleteFromS3(game[field]);
        game[field] = null;
      }
    }
  }

  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Game.findById(game._id)
    .populate("businessId", "name")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  return response(res, 200, "CrossZero game updated", populated);
});

// GET GAMES BY BUSINESS SLUG
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ slug: req.params.slug });
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({ businessId: business._id, ...CZ_FILTER })
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  return response(res, 200, "CrossZero games fetched", games);
});

// GET GAME BY ID
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ _id: req.params.id, ...CZ_FILTER })
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  if (!game) return response(res, 404, "CrossZero game not found");
  return response(res, 200, "CrossZero game found", game);
});

// GET GAME BY SLUG
exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ slug: req.params.slug, ...CZ_FILTER })
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  if (!game) return response(res, 404, "CrossZero game not found");
  return response(res, 200, "CrossZero game found", game);
});

// SOFT DELETE
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ _id: req.params.id, ...CZ_FILTER });
  if (!game) return response(res, 404, "CrossZero game not found");

  const sessionsExist = await GameSession.exists({ gameId: game._id });
  if (sessionsExist) {
    return response(res, 400, "Cannot delete a game with existing sessions");
  }

  await game.softDelete(req.user.id);

  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero game moved to recycle bin");
});

// RESTORE
exports.restoreGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, ...CZ_FILTER });
  if (!game) return response(res, 404, "Game not found in trash");

  const conflict = await Game.findOne({ _id: { $ne: game._id }, slug: game.slug, isDeleted: false, ...CZ_FILTER });
  if (conflict) return response(res, 409, "Cannot restore: slug already in use");

  await game.restore();

  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero game restored", game);
});

// PERMANENT DELETE
exports.permanentDeleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, ...CZ_FILTER });
  if (!game) return response(res, 404, "Game not found in trash");

  if (game.coverImage) await deleteFromS3(game.coverImage);
  if (game.nameImage) await deleteFromS3(game.nameImage);
  if (game.backgroundImage) await deleteFromS3(game.backgroundImage);
  if (game.xImage) await deleteFromS3(game.xImage);
  if (game.oImage) await deleteFromS3(game.oImage);

  const businessId = game.businessId;
  await cascadeDeleteGame(game._id);
  await game.deleteOne();

  recomputeAndEmit(businessId).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "CrossZero game permanently deleted");
});

// RESTORE ALL FROM TRASH
exports.restoreAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted(CZ_FILTER);
  if (!games.length) return response(res, 404, "No CrossZero games in trash");

  for (const game of games) await game.restore();

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${games.length} CrossZero game(s)`);
});

// PERMANENT DELETE ALL FROM TRASH
exports.permanentDeleteAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted(CZ_FILTER);
  if (!games.length) return response(res, 404, "No CrossZero games in trash");

  for (const game of games) {
    if (game.coverImage) await deleteFromS3(game.coverImage);
    if (game.nameImage) await deleteFromS3(game.nameImage);
    if (game.backgroundImage) await deleteFromS3(game.backgroundImage);
    if (game.xImage) await deleteFromS3(game.xImage);
    if (game.oImage) await deleteFromS3(game.oImage);
    await cascadeDeleteGame(game._id);
    await game.deleteOne();
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "All CrossZero games in trash permanently deleted");
});

async function cascadeDeleteGame(gameId) {
  const sessions = await GameSession.find({ gameId });
  const playerIds = sessions.flatMap((s) => (s.players || []).map((p) => p.playerId));
  if (playerIds.length) await Player.deleteMany({ _id: { $in: playerIds } });
  await GameSession.deleteMany({ gameId });
}
