const Game = require("../../models/Game");
const Business = require("../../models/Business");
const Player = require("../../models/Player");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const GameSession = require("../../models/GameSession"); 
// Create PvP Game
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

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const sanitizedSlug = await generateUniqueSlug(Game, "slug", slug);

  const businessId = business._id;

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
    mode: "pvp",
  });

  return response(res, 201, "PvP game created", game);
});

// Update Game
exports.updateGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

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
  return response(res, 200, "PvP Game updated", game);
});

// Get PvP games for a business
exports.getGamesByBusinessSlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ slug: req.params.slug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const games = await Game.find({ businessId: business._id, mode: "pvp" }).notDeleted();
  return response(res, 200, `PvP Games fetched for ${business.name}`, games);
});

// Get PvP game by ID or slug
exports.getGameById = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id).notDeleted();
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

exports.getGameBySlug = asyncHandler(async (req, res) => {
  const game = await Game.findOne({ slug: req.params.slug }).notDeleted();
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");
  return response(res, 200, "Game found", game);
});

// Soft delete PvP game
exports.deleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game || game.mode !== "pvp") return response(res, 404, "Game not found");

  const playersExist = await Player.exists({ gameId: game._id });
  if (playersExist) {
    return response(res, 400, "Cannot delete game with existing sessions/players");
  }

  await game.softDelete(req.user.id);
  return response(res, 200, "PvP game moved to recycle bin");
});

// Restore PvP game
exports.restoreGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, mode: "pvp" });
  if (!game) return response(res, 404, "Game not found in trash");

  // check slug conflicts
  const conflict = await Game.findOne({
    _id: { $ne: game._id },
    slug: game.slug,
    isDeleted: false,
  });
  if (conflict) return response(res, 409, "Cannot restore: slug already in use");

  await game.restore();
  return response(res, 200, "PvP game restored", game);
});

// Permanently delete PvP game
exports.permanentDeleteGame = asyncHandler(async (req, res) => {
  const game = await Game.findOneDeleted({ _id: req.params.id, mode: "pvp" });
  if (!game) return response(res, 404, "Game not found in trash");

  if (game.coverImage) await deleteImage(game.coverImage);
  if (game.nameImage) await deleteImage(game.nameImage);
  if (game.backgroundImage) await deleteImage(game.backgroundImage);

  await GameSession.deleteMany({ gameId: game._id });
  await Player.deleteMany({ gameId: game._id });

  await game.deleteOne();
  return response(res, 200, "PvP game permanently deleted");
});
