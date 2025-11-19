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
  const { businessSlug, title, slug, countdownTimer, gameSessionTimer } =
    req.body;

  if (!businessSlug || !title || !slug || !gameSessionTimer)
    return response(res, 400, "Missing required fields");

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
  const businessId = business._id;

  // Upload main images
  let coverImage = {},
    nameImage = {},
    backgroundImage = {};

  if (req.files?.cover?.[0])
    coverImage = await uploadToS3(req.files.cover[0], business.slug, "TapMatch", {
      inline: true,
    });
  if (req.files?.name?.[0])
    nameImage = await uploadToS3(req.files.name[0], business.slug, "TapMatch", {
      inline: true,
    });
  if (req.files?.background?.[0])
    backgroundImage = await uploadToS3(req.files.background[0], business.slug, "TapMatch", {
      inline: true,
    });

  // Upload all memory images
  const memoryImages = [];
  if (req.files?.memoryImages?.length) {
    for (const file of req.files.memoryImages) {
      const uploaded = await uploadToS3(file, business.slug, "TapMatch", { inline: true });
      memoryImages.push({ key: uploaded.key, url: uploaded.fileUrl });
    }
  }

  const game = await Game.create({
    businessId,
    title,
    slug: sanitizedSlug,
    type: "memory",
    coverImage: coverImage.fileUrl,
    nameImage: nameImage.fileUrl,
    backgroundImage: backgroundImage.fileUrl,
    memoryImages,
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
  const game = await Game.findById(req.params.id).notDeleted();
  if (!game || game.type !== "memory")
    return response(res, 404, "TapMatch game not found");

  const { title, slug, countdownTimer, gameSessionTimer } = req.body;

  if (slug && slug !== game.slug) {
    const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);
    game.slug = sanitizedSlug;
  }

  if (title) game.title = title;
  if (countdownTimer) game.countdownTimer = countdownTimer;
  if (gameSessionTimer) game.gameSessionTimer = gameSessionTimer;

  const business = await Business.findById(game.businessId);

  // Replace images if new ones provided
  if (req.files?.cover?.[0]) {
    await deleteFromS3(game.coverImage);
    const uploaded = await uploadToS3(req.files.cover[0], business.slug, "TapMatch", {
      inline: true,
    });
    game.coverImage = uploaded.fileUrl;
  }

  if (req.files?.name?.[0]) {
    await deleteFromS3(game.nameImage);
    const uploaded = await uploadToS3(req.files.name[0], business.slug, "TapMatch", {
      inline: true,
    });
    game.nameImage = uploaded.fileUrl;
  }

  if (req.files?.background?.[0]) {
    await deleteFromS3(game.backgroundImage);
    const uploaded = await uploadToS3(req.files.background[0], business.slug, "TapMatch", {
      inline: true,
    });
    game.backgroundImage = uploaded.fileUrl;
  }

  // Replace all memory images
  if (req.files?.memoryImages?.length) {
    for (const img of game.memoryImages) {
      await deleteFromS3(img.key || img.url);
    }

    // Upload new ones
    const newMemoryImages = [];
    for (const file of req.files.memoryImages) {
      const uploaded = await uploadToS3(file, business.slug, "TapMatch", { inline: true });
      newMemoryImages.push({ key: uploaded.key, url: uploaded.fileUrl });
    }
    game.memoryImages = newMemoryImages;
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
  const games = await Game.find({ type: "memory" })
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

  const games = await Game.find({ businessId: business._id, type: "memory" })
    .notDeleted()
    .populate("businessId", "name slug")
    .sort({ createdAt: -1 });

  return response(res, 200, `TapMatch games for ${business.name}`, games);
});

// ---------------------------------------------------------
// Get Game by ID
// ---------------------------------------------------------
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id).notDeleted();
  if (!game || game.type !== "memory")
    return response(res, 404, "TapMatch game not found");

  return response(res, 200, "Game found", game);
});

// ---------------------------------------------------------
// Get Game by Slug
// ---------------------------------------------------------
exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({
    slug: req.params.slug,
    type: "memory",
  }).notDeleted();

  if (!game) return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// ---------------------------------------------------------
// Soft Delete Game
// ---------------------------------------------------------
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game || game.type !== "memory")
    return response(res, 404, "TapMatch game not found");

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
  const games = await Game.findDeleted({ type: "memory" });
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
  const games = await Game.findDeleted({ type: "memory" });
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
