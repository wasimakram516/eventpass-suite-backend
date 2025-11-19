const Game = require("../../models/Game");
const Business = require("../../models/Business");
const Player = require("../../models/Player");
const GameSession = require("../../models/GameSession");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// Create Game using businessSlug
exports.createGame = asyncHandler(async (req, res) => {
  const {
    businessSlug,
    title,
    slug,
    choicesCount,
    countdownTimer,
    gameSessionTimer,
  } = req.body;

  if (!businessSlug || !title || !slug || !choicesCount || !gameSessionTimer) {
    return response(res, 400, "Missing required fields");
  }

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);

  // Find business by slug
  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const businessId = business._id;

  let coverImage = "",
    nameImage = "",
    backgroundImage = "";

  if (req.files?.cover) {
    const uploaded = await uploadToS3(req.files.cover[0], business.slug, "QuizNest", {
      inline: true,
    });
    coverImage = uploaded.fileUrl;
  }

  if (req.files?.name) {
    const uploaded = await uploadToS3(req.files.name[0], business.slug, "QuizNest", {
      inline: true,
    });
    nameImage = uploaded.fileUrl;
  }

  if (req.files?.background) {
    const uploaded = await uploadToS3(req.files.background[0], business.slug, "QuizNest", {
      inline: true,
    });
    backgroundImage = uploaded.fileUrl;
  }

  // Save game with resolved businessId
  const game = await Game.create({
    businessId,
    title,
    slug: sanitizedSlug,
    coverImage,
    nameImage,
    backgroundImage,
    choicesCount,
    countdownTimer: countdownTimer || 3,
    gameSessionTimer,
    mode: "solo",
  });

  // Fire background recompute
  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Game created", game);
});

// Update Game
exports.updateGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) return response(res, 404, "Game not found");

  const { title, slug, choicesCount, countdownTimer, gameSessionTimer } =
    req.body;

  if (slug && slug !== game.slug) {
    const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
    game.slug = sanitizedSlug;
  }

  game.title = title || game.title;
  game.choicesCount = choicesCount || game.choicesCount;
  game.countdownTimer = countdownTimer || game.countdownTimer;
  game.gameSessionTimer = gameSessionTimer || game.gameSessionTimer;

  const business = await Business.findById(game.businessId);
  if (!business) return response(res, 404, "Business not found");

  if (req.files?.cover) {
    if (game.coverImage) await deleteFromS3(game.coverImage);
    const uploaded = await uploadToS3(req.files.cover[0], business.slug, "QuizNest", {
      inline: true,
    });
    game.coverImage = uploaded.fileUrl;
  }

  if (req.files?.name) {
    if (game.nameImage) await deleteFromS3(game.nameImage);
    const uploaded = await uploadToS3(req.files.name[0], business.slug, "QuizNest", {
      inline: true,
    });
    game.nameImage = uploaded.fileUrl;
  }

  if (req.files?.background) {
    if (game.backgroundImage) await deleteFromS3(game.backgroundImage);
    const uploaded = await uploadToS3(req.files.background[0], business.slug, "QuizNest", {
      inline: true,
    });
    game.backgroundImage = uploaded.fileUrl;
  }

  await game.save();

  // Fire background recompute
  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Solo Game updated", game);
});

// Get Games by Business Slug
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ slug: req.params.slug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({ businessId: business._id, mode: "solo" })
    .notDeleted()
    .populate("businessId", "name slug")
    .sort({ createdAt: -1 });
  return response(res, 200, `Solo Games fetched for ${business.name}`, games);
});

// Get All Games
exports.getAllGames = asyncHandler(async (req, res) => {
  const games = await Game.find().notDeleted().populate("businessId", "name slug");
  return response(res, 200, "All games fetched", games);
});

// Get Game by ID
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id).notDeleted();
  if (!game) return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// Get game by slug
exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ slug: req.params.slug }).notDeleted();
  if (!game) return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// Delete Game
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) return response(res, 404, "Game not found");

  const playersExist = await Player.exists({ gameId: game._id });
  if (playersExist) {
    return response(res, 400, "Cannot delete game with existing game sessions");
  }

  await game.softDelete(req.user.id);

  // Fire background recompute
  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game moved to recycle bin");
});

exports.restoreGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, mode: "solo" });
  if (!game) return response(res, 404, "Game not found in trash");

  await game.restore();

  // Fire background recompute
  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game restored", game);
});

exports.permanentDeleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, mode: "solo" });
  if (!game) return response(res, 404, "Game not found in trash");

  // Cascade permanent delete all related data
  await cascadePermanentDeleteGame(game._id);

  if (game.coverImage) await deleteFromS3(game.coverImage);
  if (game.nameImage) await deleteFromS3(game.nameImage);
  if (game.backgroundImage) await deleteFromS3(game.backgroundImage);

  await game.deleteOne();

  // Fire background recompute
  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game permanently deleted");
});

// Restore all games
exports.restoreAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted({ mode: "solo" });
  if (!games.length) {
    return response(res, 404, "No solo games found in trash to restore");
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

// Permanent delete all games
exports.permanentDeleteAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted({ mode: "solo" });
  if (!games.length) {
    return response(res, 404, "No solo games found in trash to delete");
  }

  for (const game of games) {
    await cascadePermanentDeleteGame(game._id);

    if (game.coverImage) await deleteFromS3(game.coverImage);
    if (game.nameImage) await deleteFromS3(game.nameImage);
    if (game.backgroundImage) await deleteFromS3(game.backgroundImage);

    await game.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "All eligible games permanently deleted");
});



/* Cascade permanent delete everything linked to a game */
async function cascadePermanentDeleteGame(gameId) {
  const sessions = await GameSession.find({ gameId });

  if (sessions.length > 0) {
    const playerIds = sessions.flatMap(session =>
      session.players.map(p => p.playerId)
    );

    if (playerIds.length > 0) {
      await Player.deleteMany({ _id: { $in: playerIds } });
    }

    await GameSession.deleteMany({ gameId });
  }
}
