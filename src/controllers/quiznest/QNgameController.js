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
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const {
    businessSlug,
    title,
    slug,
    choicesCount,
    countdownTimer,
    gameSessionTimer,
    coverImage,
    nameImage,
    backgroundImage,
    memoryImages,
  } = req.body;

  if (!businessSlug || !title || !slug || !choicesCount || !gameSessionTimer) {
    return response(res, 400, "Missing required fields");
  }

  const missingMedia = [];
  if (!coverImage || coverImage.trim() === "") {
    missingMedia.push("Cover Image");
  }
  if (!nameImage || nameImage.trim() === "") {
    missingMedia.push("Name Image");
  }
  if (!backgroundImage || backgroundImage.trim() === "") {
    missingMedia.push("Background Image");
  }

  if (missingMedia.length > 0) {
    return response(res, 400, `Missing required media: ${missingMedia.join(", ")}`);
  }

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const businessId = business._id;

  const game = await Game.createWithAuditUser(
    {
      businessId,
      title,
      slug: sanitizedSlug,
      coverImage,
      nameImage,
      backgroundImage,
      memoryImages: memoryImages || [],
      choicesCount,
      countdownTimer: countdownTimer || 3,
      gameSessionTimer,
      mode: "solo",
      type: "quiz",
    },
    req.user
  );

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Game.findById(game._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 201, "Game created", populated || game);
});

// Update Game
exports.updateGame = asyncHandler(async (req, res) => {
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const game = await Game.findOne({
    _id: req.params.id,
    mode: "solo",
    type: "quiz",
  });
  if (!game) return response(res, 404, "Game not found");

  const {
    title,
    slug,
    choicesCount,
    countdownTimer,
    gameSessionTimer,
    coverImage,
    nameImage,
    backgroundImage,
    memoryImages,
  } = req.body;

  if (slug && slug !== game.slug) {
    const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
    game.slug = sanitizedSlug;
  }

  game.title = title || game.title;
  game.choicesCount = choicesCount || game.choicesCount;
  game.countdownTimer = countdownTimer || game.countdownTimer;
  game.gameSessionTimer = gameSessionTimer || game.gameSessionTimer;

  if (coverImage !== undefined && coverImage) {
    if (game.coverImage && game.coverImage !== coverImage) {
      await deleteFromS3(game.coverImage);
    }
    game.coverImage = coverImage;
  }

  if (nameImage !== undefined && nameImage) {
    if (game.nameImage && game.nameImage !== nameImage) {
      await deleteFromS3(game.nameImage);
    }
    game.nameImage = nameImage;
  }

  if (backgroundImage !== undefined && backgroundImage) {
    if (game.backgroundImage && game.backgroundImage !== backgroundImage) {
      await deleteFromS3(game.backgroundImage);
    }
    game.backgroundImage = backgroundImage;
  }

  if (memoryImages !== undefined) {
    if (game.memoryImages && game.memoryImages.length > 0) {
      for (const img of game.memoryImages) {
        if (img && img.url) {
          await deleteFromS3(img.url).catch(console.error);
        }
      }
    }
    game.memoryImages = Array.isArray(memoryImages)
      ? memoryImages.map((url) => ({ url }))
      : [];
  }

  game.setAuditUser(req.user);
  await game.save();

  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Game.findById(game._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 200, "Solo Game updated", populated || game);
});

// Get Games by Business Slug
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({
    slug: req.params.slug,
  });
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({
    businessId: business._id,
    type: "quiz",
    mode: "solo",
  })
    
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ createdAt: -1 });

  return response(
    res,
    200,
    `Solo Quiz Games fetched for ${business.name}`,
    games
  );
});

// Get All Games
exports.getAllGames = asyncHandler(async (req, res) => {
  const games = await Game.find({
    type: "quiz",
    mode: "solo",
  })
    
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  return response(res, 200, "All solo quiz games fetched", games);
});

// Get Game by ID
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    _id: req.params.id,
    type: "quiz",
    mode: "solo",
  })
    
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  if (!game) return response(res, 404, "Game not found");

  return response(res, 200, "Game found", game);
});

// Get game by slug
exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    slug: req.params.slug,
    type: "quiz",
    mode: "solo",
  })
    
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  if (!game) return response(res, 404, "Game not found");

  return response(res, 200, "Game found", game);
});

// Delete Game
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    _id: req.params.id,
    mode: "solo",
    type: "quiz",
  });
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
  const game = await Game.findOneDeleted({
    _id: req.params.id,
    mode: "solo",
    type: "quiz",
  });
  if (!game) return response(res, 404, "Game not found in trash");

  await game.restore();

  // Fire background recompute
  recomputeAndEmit(game.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Game restored", game);
});

exports.permanentDeleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({
    _id: req.params.id,
    mode: "solo",
    type: "quiz",
  });
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
  const games = await Game.findDeleted({ mode: "solo", type: "quiz" });
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
  const games = await Game.findDeleted({ mode: "solo", type: "quiz" });
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
    const playerIds = sessions.flatMap((session) =>
      session.players.map((p) => p.playerId)
    );

    if (playerIds.length > 0) {
      await Player.deleteMany({ _id: { $in: playerIds } });
    }

    await GameSession.deleteMany({ gameId });
  }
}
