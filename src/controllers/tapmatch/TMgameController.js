const Game = require("../../models/Game");
const Business = require("../../models/Business");
const Player = require("../../models/Player");
const GameSession = require("../../models/GameSession");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// ---------------------------------------------------------
// Create TapMatch Game
// ---------------------------------------------------------
exports.createGame = asyncHandler(async (req, res) => {
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const {
    businessSlug,
    title,
    slug,
    countdownTimer,
    gameSessionTimer,
    coverImage,
    nameImage,
    backgroundImage,
    memoryImages,
  } = req.body;

  if (!businessSlug || !title || !slug || !gameSessionTimer) {
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

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
  const businessId = business._id;

  const processedMemoryImages = Array.isArray(memoryImages)
    ? memoryImages.map((url) => {
        let key = url;
        if (url && url.startsWith("http")) {
          try {
            const env = require("../../config/env");
            const base = env.aws.cloudfrontUrl.endsWith("/")
              ? env.aws.cloudfrontUrl
              : env.aws.cloudfrontUrl + "/";
            key = decodeURIComponent(url.replace(base, ""));
          } catch (err) {
            console.warn("Failed to extract S3 key from URL:", url);
          }
        }
        return { key, url };
      })
    : [];

  const game = await Game.create({
    businessId,
    title,
    slug: sanitizedSlug,
    type: "memory",
    coverImage,
    nameImage,
    backgroundImage,
    memoryImages: processedMemoryImages,
    countdownTimer: countdownTimer || 3,
    gameSessionTimer,
    mode: "solo",
  });

  recomputeAndEmit(businessId).catch((err) =>
    console.error("Dashboard recompute failed:", err.message)
  );

  return response(res, 201, "TapMatch game created", game);
});

// ---------------------------------------------------------
// Update TapMatch Game
// ---------------------------------------------------------
exports.updateGame = asyncHandler(async (req, res) => {
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const game = await Game.findOne({
    _id: req.params.id,
    type: "memory",
    mode: "solo",
  }).notDeleted();
  if (!game) return response(res, 404, "TapMatch game not found");

  const {
    title,
    slug,
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

  if (title) game.title = title;
  if (countdownTimer) game.countdownTimer = countdownTimer;
  if (gameSessionTimer) game.gameSessionTimer = gameSessionTimer;

  if (coverImage !== undefined) {
    if (game.coverImage && game.coverImage !== coverImage) {
      await deleteFromS3(game.coverImage);
    }
    game.coverImage = coverImage || null;
  }

  if (nameImage !== undefined) {
    if (game.nameImage && game.nameImage !== nameImage) {
      await deleteFromS3(game.nameImage);
    }
    game.nameImage = nameImage || null;
  }

  if (backgroundImage !== undefined) {
    if (game.backgroundImage && game.backgroundImage !== backgroundImage) {
      await deleteFromS3(game.backgroundImage);
    }
    game.backgroundImage = backgroundImage || null;
  }

  if (memoryImages !== undefined) {
    if (Array.isArray(game.memoryImages) && game.memoryImages.length > 0) {
      for (const img of game.memoryImages) {
        if (img && (img.key || img.url)) {
          await deleteFromS3(img.key || img.url);
        }
      }
    }

    const processedMemoryImages = Array.isArray(memoryImages)
      ? memoryImages.map((url) => {
          let key = url;
          if (url && url.startsWith("http")) {
            try {
              const env = require("../../config/env");
              const base = env.aws.cloudfrontUrl.endsWith("/")
                ? env.aws.cloudfrontUrl
                : env.aws.cloudfrontUrl + "/";
              key = decodeURIComponent(url.replace(base, ""));
            } catch (err) {
              console.warn("Failed to extract S3 key from URL:", url);
            }
          }
          return { key, url };
        })
      : [];
    game.memoryImages = processedMemoryImages;
  }

  await game.save();
  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Dashboard recompute failed:", err.message)
  );

  return response(res, 200, "TapMatch game updated", game);
});

// ---------------------------------------------------------
// Get All TapMatch Games
// ---------------------------------------------------------
exports.getAllGames = asyncHandler(async (req, res) => {
  const games = await Game.find({ type: "memory", mode: "solo" })
    .notDeleted()
    .populate("businessId", "name slug")
    .sort({ createdAt: -1 });

  return response(res, 200, "All TapMatch games fetched", games);
});

// ---------------------------------------------------------
// Get Games by Business Slug
// ---------------------------------------------------------
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({
    slug: req.params.slug,
  }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({
    businessId: business._id,
    type: "memory",
    mode: "solo",
  })
    .notDeleted()
    .populate("businessId", "name slug")
    .sort({ createdAt: -1 });

  return response(res, 200, `TapMatch games for ${business.name}`, games);
});

// ---------------------------------------------------------
// Get Game by ID
// ---------------------------------------------------------
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    _id: req.params.id,
    type: "memory",
    mode: "solo",
  }).notDeleted();
  if (!game) return response(res, 404, "TapMatch game not found");

  return response(res, 200, "Game found", game);
});

// ---------------------------------------------------------
// Get Game by Slug
// ---------------------------------------------------------
exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    slug: req.params.slug,
    type: "memory",
    mode: "solo",
  }).notDeleted();

  if (!game) return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// ---------------------------------------------------------
// Soft Delete Game
// ---------------------------------------------------------
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    _id: req.params.id,
    type: "memory",
    mode: "solo",
  });
  if (!game) return response(res, 404, "TapMatch game not found");

  const playersExist = await Player.exists({ gameId: game._id });
  if (playersExist)
    return response(res, 400, "Cannot delete game with active sessions");

  await game.softDelete(req.user.id);

  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "Game moved to recycle bin");
});

// ---------------------------------------------------------
// Restore Game
// ---------------------------------------------------------
exports.restoreGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({
    _id: req.params.id,
    type: "memory",
    mode: "solo",
  });
  if (!game) return response(res, 404, "Game not found in trash");

  await game.restore();

  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "Game restored", game);
});

// ---------------------------------------------------------
// Restore All Games
// ---------------------------------------------------------
exports.restoreAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted({ type: "memory", mode: "solo" });
  if (!games.length) return response(res, 404, "No TapMatch games in trash");

  for (const game of games) await game.restore();

  recomputeAndEmit(null).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${games.length} games`);
});

// ---------------------------------------------------------
// Permanently Delete Game
// ---------------------------------------------------------
exports.permanentDeleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({
    _id: req.params.id,
    type: "memory",
    mode: "solo",
  });
  if (!game) return response(res, 404, "Game not found in trash");

  // Delete assets from S3
  if (game.coverImage) await deleteFromS3(game.coverImage);
  if (game.nameImage) await deleteFromS3(game.nameImage);
  if (game.backgroundImage) await deleteFromS3(game.backgroundImage);
  for (const img of game.memoryImages) await deleteFromS3(img.key);

  await GameSession.deleteMany({ gameId: game._id });
  await Player.deleteMany({ sessionId: { $in: game._id } });
  await game.deleteOne();

  recomputeAndEmit(game.businessId).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "TapMatch game permanently deleted");
});

// ---------------------------------------------------------
// Permanently Delete All Games
// ---------------------------------------------------------
exports.permanentDeleteAllGames = asyncHandler(async (req, res) => {
  const games = await Game.findDeleted({ type: "memory", mode: "solo" });
  if (!games.length) return response(res, 404, "No TapMatch games in trash");

  for (const game of games) {
    if (game.coverImage) await deleteFromS3(game.coverImage);
    if (game.nameImage) await deleteFromS3(game.nameImage);
    if (game.backgroundImage) await deleteFromS3(game.backgroundImage);
    for (const img of game.memoryImages) await deleteFromS3(img.key);

    await GameSession.deleteMany({ gameId: game._id });
    await Player.deleteMany({ sessionId: { $in: game._id } });
    await game.deleteOne();
  }

  recomputeAndEmit(null).catch((err) =>
    console.error("Recompute failed:", err.message)
  );

  return response(res, 200, "All TapMatch games permanently deleted");
});
