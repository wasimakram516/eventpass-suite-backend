const WallConfig = require("../../models/WallConfig");
const DisplayMedia = require("../../models/DisplayMedia");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

function normalizeRandomSizes(randomSizes) {
  const defaults = { enabled: false, min: 150, max: 300 };
  if (!randomSizes || typeof randomSizes !== "object") return defaults;
  const enabled = Boolean(randomSizes.enabled);
  const min =
    typeof randomSizes.min === "number" && Number.isFinite(randomSizes.min)
      ? randomSizes.min
      : defaults.min;
  const max =
    typeof randomSizes.max === "number" && Number.isFinite(randomSizes.max)
      ? randomSizes.max
      : defaults.max;
  if (!enabled) return { enabled: false, min, max };
  if (min > max) return { enabled, min: max, max: min };
  return { enabled, min, max };
}

function normalizeMosaicGrid(mosaicGrid) {
  const defaults = { rows: 10, cols: 15 };
  if (!mosaicGrid || typeof mosaicGrid !== "object") return defaults;
  const rows =
    typeof mosaicGrid.rows === "number" && Number.isFinite(mosaicGrid.rows)
      ? Math.max(1, Math.trunc(mosaicGrid.rows))
      : defaults.rows;
  const cols =
    typeof mosaicGrid.cols === "number" && Number.isFinite(mosaicGrid.cols)
      ? Math.max(1, Math.trunc(mosaicGrid.cols))
      : defaults.cols;
  return { rows, cols };
}

function normalizeCardSettings(cardSettings) {
  const defaults = { order: "sequential", backgroundColor: "#ffffff", randomColors: false, imageShape: "circle", mediaType: "type1" };
  if (!cardSettings || typeof cardSettings !== "object") return defaults;
  const order = ["sequential", "random"].includes(cardSettings.order)
    ? cardSettings.order
    : defaults.order;
  const backgroundColor = typeof cardSettings.backgroundColor === "string"
    ? cardSettings.backgroundColor
    : defaults.backgroundColor;
  const randomColors = Boolean(cardSettings.randomColors);
  const imageShape = ["circle", "top-70", "full"].includes(cardSettings.imageShape)
    ? cardSettings.imageShape
    : defaults.imageShape;
  const mediaType = ["type1", "type2"].includes(cardSettings.mediaType)
    ? cardSettings.mediaType
    : defaults.mediaType;
  const mediaType2TextColor = typeof cardSettings.mediaType2TextColor === "string"
    ? cardSettings.mediaType2TextColor
    : "#000000";
  const mediaType2SignatureColor = typeof cardSettings.mediaType2SignatureColor === "string"
    ? cardSettings.mediaType2SignatureColor
    : "#000000";
  return { order, backgroundColor, randomColors, imageShape, mediaType, mediaType2TextColor, mediaType2SignatureColor };
}

function validateRandomSizesPayload(randomSizes) {
  if (!randomSizes || typeof randomSizes !== "object") return null;
  const enabled = Boolean(randomSizes.enabled);
  if (!enabled) return null;
  if (
    typeof randomSizes.min !== "number" ||
    !Number.isFinite(randomSizes.min) ||
    typeof randomSizes.max !== "number" ||
    !Number.isFinite(randomSizes.max)
  ) {
    return "When randomSizes.enabled is true, min and max must be valid numbers.";
  }
  if (randomSizes.min <= 0 || randomSizes.max <= 0) {
    return "randomSizes min and max must be positive values.";
  }
  if (randomSizes.min > randomSizes.max) {
    return "randomSizes min cannot be greater than max.";
  }
  return null;
}

function validateMosaicGridPayload(mosaicGrid) {
  if (!mosaicGrid || typeof mosaicGrid !== "object") return null;
  if (
    typeof mosaicGrid.rows !== "number" ||
    !Number.isFinite(mosaicGrid.rows) ||
    typeof mosaicGrid.cols !== "number" ||
    !Number.isFinite(mosaicGrid.cols)
  ) {
    return "mosaicGrid rows and cols must be valid numbers.";
  }
  if (mosaicGrid.rows <= 0 || mosaicGrid.cols <= 0) {
    return "mosaicGrid rows and cols must be positive values.";
  }
  return null;
}

function validateCardSettingsPayload(cardSettings) {
  if (!cardSettings || typeof cardSettings !== "object") return null;
  if (cardSettings.order && !["sequential", "random"].includes(cardSettings.order)) {
    return "cardSettings order must be either sequential or random.";
  }
  if (cardSettings.backgroundColor && !/^#([A-Fa-f0-9]{3}){1,2}$/.test(cardSettings.backgroundColor)) {
    return "cardSettings backgroundColor must be a valid hex color code.";
  }
  if (cardSettings.imageShape && !["circle", "top-70", "full"].includes(cardSettings.imageShape)) {
    return "cardSettings imageShape must be circle, top-70, or full.";
  }
  if (cardSettings.mediaType && !["type1", "type2"].includes(cardSettings.mediaType)) {
    return "cardSettings mediaType must be either type1 or type2.";
  }
  if (cardSettings.mediaType2TextColor && !/^#([A-Fa-f0-9]{3}){1,2}$/.test(cardSettings.mediaType2TextColor)) {
    return "cardSettings mediaType2TextColor must be a valid hex color code.";
  }
  if (cardSettings.mediaType2SignatureColor && !/^#([A-Fa-f0-9]{3}){1,2}$/.test(cardSettings.mediaType2SignatureColor)) {
    return "cardSettings mediaType2SignatureColor must be a valid hex color code.";
  }
  return null;
}

function normalizeBackground(background) {
  if (!background || typeof background !== "object") {
    return { key: "", url: "" };
  }
  return {
    key: typeof background.key === "string" ? background.key : "",
    url: typeof background.url === "string" ? background.url : "",
  };
}

function normalizeBackgroundLogo(backgroundLogo) {
  if (!backgroundLogo || typeof backgroundLogo !== "object") return null;
  const hasUrl = typeof backgroundLogo.url === "string" && backgroundLogo.url;
  if (!hasUrl) return null;
  return {
    key: typeof backgroundLogo.key === "string" ? backgroundLogo.key : "",
    url: backgroundLogo.url,
    overlayEnabled: Boolean(backgroundLogo.overlayEnabled),
    opacity: typeof backgroundLogo.opacity === "number" ? backgroundLogo.opacity : 100,
    stampOnImages: Boolean(backgroundLogo.stampOnImages),
    stampPosition: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(backgroundLogo.stampPosition)
      ? backgroundLogo.stampPosition
      : "bottom-right",
  };
}

function buildWallResponse(wall) {
  const randomSizes = normalizeRandomSizes(wall.randomSizes);
  const mosaicGrid = normalizeMosaicGrid(wall.mosaicGrid);
  const cardSettings = normalizeCardSettings(wall.cardSettings);
  const background = normalizeBackground(wall.background);
  const backgroundLogo = normalizeBackgroundLogo(wall.backgroundLogo);

  return {
    _id: wall._id,
    name: wall.name,
    slug: wall.slug,
    mode: wall.mode,
    randomSizes,
    mosaicGrid,
    cardSettings,
    background,
    backgroundLogo,
    business: wall.business
      ? {
        _id: wall.business._id,
        name: wall.business.name,
        slug: wall.business.slug,
      }
      : null,
    createdAt: wall.createdAt,
    updatedAt: wall.updatedAt,
    createdBy: wall.createdBy,
    updatedBy: wall.updatedBy,
  };
}

exports.createWallConfig = asyncHandler(async (req, res) => {
  const { name, slug, mode, businessId } = req.body;
  const { randomSizes, mosaicGrid, cardSettings, background, backgroundLogo } = req.body;

  if (!name || !slug || !["mosaic", "card", "bubble"].includes(mode)) {
    return response(res, 400, "Name, slug, and a valid mode are required.");
  }

  const randomSizesError = validateRandomSizesPayload(randomSizes);
  if (randomSizesError) {
    return response(res, 400, randomSizesError);
  }

  const mosaicGridError = validateMosaicGridPayload(mosaicGrid);
  if (mosaicGridError) {
    return response(res, 400, mosaicGridError);
  }

  const cardSettingsError = validateCardSettingsPayload(cardSettings);
  if (cardSettingsError) {
    return response(res, 400, cardSettingsError);
  }

  const business = await Business.findById(businessId);
  if (!business) {
    return response(res, 404, "Business not found.");
  }

  const finalSlug = await generateUniqueSlug(WallConfig, "slug", slug);

  const wallPayload = {
    name,
    slug: finalSlug,
    mode,
    business: business._id,
  };

  if (randomSizes && typeof randomSizes === "object") {
    wallPayload.randomSizes = normalizeRandomSizes(randomSizes);
  }

  if (mosaicGrid && typeof mosaicGrid === "object") {
    wallPayload.mosaicGrid = normalizeMosaicGrid(mosaicGrid);
  }

  if (cardSettings && typeof cardSettings === "object") {
    wallPayload.cardSettings = normalizeCardSettings(cardSettings);
  }

  if (background && typeof background === "object") {
    wallPayload.background = normalizeBackground(background);
  }

  if (backgroundLogo && typeof backgroundLogo === "object") {
    wallPayload.backgroundLogo = normalizeBackgroundLogo(backgroundLogo);
  }

  const wall = await WallConfig.createWithAuditUser(wallPayload, req.user);

  wall.business = businessId;
  await wall.populate("business");

  recomputeAndEmit(wall.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(
    res,
    201,
    "Wall configuration created.",
    buildWallResponse(wall),
  );
});

exports.updateWallConfig = asyncHandler(async (req, res) => {
  const wall = await WallConfig.findById(req.params.id)
    .populate("business")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!wall) return response(res, 404, "Wall configuration not found.");

  const { name, slug, mode, randomSizes, mosaicGrid, cardSettings, background, backgroundLogo } = req.body;

  if (name) wall.name = name;
  if (mode) {
    if (!["mosaic", "card", "bubble"].includes(mode)) {
      return response(res, 400, "Invalid wall mode.");
    }
    wall.mode = mode;
  }

  const randomSizesError = validateRandomSizesPayload(randomSizes);
  if (randomSizesError) {
    return response(res, 400, randomSizesError);
  }

  const mosaicGridError = validateMosaicGridPayload(mosaicGrid);
  if (mosaicGridError) {
    return response(res, 400, mosaicGridError);
  }

  const cardSettingsError = validateCardSettingsPayload(cardSettings);
  if (cardSettingsError) {
    return response(res, 400, cardSettingsError);
  }

  if (randomSizes && typeof randomSizes === "object") {
    wall.randomSizes = normalizeRandomSizes(randomSizes);
  }

  if (mosaicGrid && typeof mosaicGrid === "object") {
    wall.mosaicGrid = normalizeMosaicGrid(mosaicGrid);
  }

  if (cardSettings && typeof cardSettings === "object") {
    wall.cardSettings = normalizeCardSettings(cardSettings);
  }

  if (background && typeof background === "object") {
    wall.background = normalizeBackground(background);
  }

  if (backgroundLogo && typeof backgroundLogo === "object") {
    wall.backgroundLogo = normalizeBackgroundLogo(backgroundLogo);
  }

  if (slug && slug !== wall.slug) {
    wall.slug = await generateUniqueSlug(WallConfig, "slug", slug);
  }

  wall.setAuditUser(req.user);
  await wall.save();

  recomputeAndEmit(wall.business._id || null).catch((err) =>
    console.error("Background recompute failed:", err.message),
  );

  return response(
    res,
    200,
    "Wall configuration updated.",
    buildWallResponse(wall),
  );
});

exports.getWallConfigs = asyncHandler(async (req, res) => {
  const configs = await WallConfig.find()
    .sort({ createdAt: -1 })
    .populate("business")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  const formatted = configs.map((wall) => buildWallResponse(wall));

  return response(res, 200, "Wall configurations fetched.", formatted);
});

exports.getWallConfigBySlug = asyncHandler(async (req, res) => {
  const wall = await WallConfig.findOne({ slug: req.params.slug })
    .populate("business")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!wall) return response(res, 404, "Wall configuration not found.");

  return response(
    res,
    200,
    "Wall configuration retrieved.",
    buildWallResponse(wall),
  );
});

exports.deleteWallConfig = asyncHandler(async (req, res) => {
  const config = await WallConfig.findById(req.params.id);
  if (!config) return response(res, 404, "Wall configuration not found.");

  await config.softDelete(req.user.id);

  // Fire background recompute
  recomputeAndEmit(config.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Wall configuration moved to recycle bin.");
});

exports.restoreWall = asyncHandler(async (req, res) => {
  const config = await WallConfig.findOneDeleted({ _id: req.params.id });
  if (!config)
    return response(res, 404, "Wall configuration not found in trash.");

  await config.restore();
  // Fire background recompute
  recomputeAndEmit(config.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Wall configuration restored.", config);
});

// Helper function to cascade permanent delete wall config and its display media
const cascadePermanentDeleteWall = async (wallId) => {
  const displayMedia = await DisplayMedia.find({ wall: wallId });

  for (const media of displayMedia) {
    await media.deleteOne();
  }

  await WallConfig.findByIdAndDelete(wallId);
};

exports.permanentDeleteWall = asyncHandler(async (req, res) => {
  const config = await WallConfig.findOneDeleted({ _id: req.params.id });
  if (!config)
    return response(res, 404, "Wall configuration not found in trash.");

  await cascadePermanentDeleteWall(config._id);
  // Fire background recompute
  recomputeAndEmit(config.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Wall configuration permanently deleted.");
});

exports.restoreAllWalls = asyncHandler(async (req, res) => {
  const deletedWalls = await WallConfig.findDeleted();

  for (const wall of deletedWalls) {
    await wall.restore();
  }
  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(
    res,
    200,
    `${deletedWalls.length} wall configurations restored.`
  );
});

exports.permanentDeleteAllWalls = asyncHandler(async (req, res) => {
  const deletedWalls = await WallConfig.findDeleted();

  for (const wall of deletedWalls) {
    await cascadePermanentDeleteWall(wall._id);
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedWalls.length} wall configurations permanently deleted.`
  );
});
