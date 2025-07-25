const Game = require("../../models/Game");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const { generateUniqueSlug } = require("../../utils/slugGenerator");

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
  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const businessId = business._id;

  // Handle image uploads
  let coverImage = "",
    nameImage = "",
    backgroundImage = "";

  if (req.files?.cover) {
    const uploaded = await uploadToCloudinary(
      req.files.cover[0].buffer,
      req.files.cover[0].mimetype
    );
    coverImage = uploaded.secure_url;
  }

  if (req.files?.name) {
    const uploaded = await uploadToCloudinary(
      req.files.name[0].buffer,
      req.files.name[0].mimetype
    );
    nameImage = uploaded.secure_url;
  }

  if (req.files?.background) {
    const uploaded = await uploadToCloudinary(
      req.files.background[0].buffer,
      req.files.background[0].mimetype
    );
    backgroundImage = uploaded.secure_url;
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

  return response(res, 201, "Game created", game);
});

// Update Game
exports.updateGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) return response(res, 404, "Game not found");

  const { title, slug, choicesCount, countdownTimer, gameSessionTimer } =
    req.body;

  if (slug && slug !== game.slug) {
      const sanitizedSlug = await generateUniqueSlug(Game,"slug",slug);
      game.slug = sanitizedSlug;
    }

  game.title = title || game.title;
  game.choicesCount = choicesCount || game.choicesCount;
  game.countdownTimer = countdownTimer || game.countdownTimer;
  game.gameSessionTimer = gameSessionTimer || game.gameSessionTimer;

  // Replace images if new ones provided
  if (req.files?.cover) {
    if (game.coverImage) await deleteImage(game.coverImage);
    const uploaded = await uploadToCloudinary(
      req.files.cover[0].buffer,
      req.files.cover[0].mimetype
    );
    game.coverImage = uploaded.secure_url;
  }

  if (req.files?.name) {
    if (game.nameImage) await deleteImage(game.nameImage);
    const uploaded = await uploadToCloudinary(
      req.files.name[0].buffer,
      req.files.name[0].mimetype
    );
    game.nameImage = uploaded.secure_url;
  }

  if (req.files?.background) {
    if (game.backgroundImage) await deleteImage(game.backgroundImage);
    const uploaded = await uploadToCloudinary(
      req.files.background[0].buffer,
      req.files.background[0].mimetype
    );
    game.backgroundImage = uploaded.secure_url;
  }

  await game.save();
  return response(res, 200, "Solo Game updated", game);
});

// Get Games by Business Slug
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ slug: req.params.slug });
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({ businessId: business._id, mode: "solo" })
    .populate("businessId", "name slug")
    .sort({ createdAt: -1 });
  return response(res, 200, `Solo Games fetched for ${business.name}`, games);
});

// Get All Games
exports.getAllGames = asyncHandler(async (req, res) => {
  const games = await Game.find().populate("businessId", "name slug");
  return response(res, 200, "All games fetched", games);
});

// Get Game by ID
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// Get game by slug
exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ slug: req.params.slug });
  if (!game) return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// Delete Game
const Player = require("../../models/Player");

exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) return response(res, 404, "Game not found");

  // Check if any players exist under this game
  const playersExist = await Player.exists({ gameId: game._id });
  if (playersExist) {
    return response(res, 400, "Cannot delete game with existing game sessions");
  }

  // Delete associated images from Cloudinary
  if (game.coverImage) await deleteImage(game.coverImage);
  if (game.nameImage) await deleteImage(game.nameImage);
  if (game.backgroundImage) await deleteImage(game.backgroundImage);

  await game.deleteOne();
  return response(res, 200, "Game deleted successfully");
});
