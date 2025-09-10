const WallConfig = require("../../models/WallConfig");
const DisplayMedia = require("../../models/DisplayMedia");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { generateUniqueSlug } = require("../../utils/slugGenerator");

// Create wall config
exports.createWallConfig = asyncHandler(async (req, res) => {
  const { name, slug, mode, businessId } = req.body;
  if (!name || !slug || !["mosaic", "card"].includes(mode)) {
    return response(res, 400, "Name, slug, and valid mode are required.");
  }

  const business = await Business.findById(businessId).notDeleted();
  if (!business) {
    return response(res, 404, "Business not found.");
  }

  const finalSlug = await generateUniqueSlug(WallConfig, "slug", slug);

  const wall = await WallConfig.create({
    name,
    slug: finalSlug,
    mode,
    business: business._id,
  });

  wall.business = business;
  await wall.populate("business");

  return response(res, 201, "Wall configuration created.", {
    _id: wall._id,
    name: wall.name,
    slug: wall.slug,
    mode: wall.mode,
    business: {
      _id: business._id,
      name: business.name,
      slug: business.slug,
    },
    createdAt: wall.createdAt,
  });
});

// Update wall config
exports.updateWallConfig = asyncHandler(async (req, res) => {
  const wall = await WallConfig.findById(req.params.id).populate("business");
  if (!wall) return response(res, 404, "Wall configuration not found.");

  const { name, slug, mode } = req.body;

  if (name) wall.name = name;
  if (mode && ["mosaic", "card"].includes(mode)) wall.mode = mode;

  if (slug && slug !== wall.slug) {
    wall.slug = await generateUniqueSlug(WallConfig, "slug", slug);
  }

  await wall.save();

  return response(res, 200, "Wall configuration updated.", {
    _id: wall._id,
    name: wall.name,
    slug: wall.slug,
    mode: wall.mode,
    business: {
      _id: wall.business._id,
      name: wall.business.name,
      slug: wall.business.slug,
    },
    updatedAt: wall.updatedAt,
  });
});

// Get all wall configs
exports.getWallConfigs = asyncHandler(async (req, res) => {
  const configs = await WallConfig.find().notDeleted()
    .sort({ createdAt: -1 })
    .populate("business");

  const formatted = configs.map((wall) => ({
    _id: wall._id,
    name: wall.name,
    slug: wall.slug,
    mode: wall.mode,
    business: wall.business
      ? {
          _id: wall.business._id,
          name: wall.business.name,
          slug: wall.business.slug,
        }
      : null,
    createdAt: wall.createdAt,
  }));

  return response(res, 200, "Wall configurations fetched.", formatted);
});

// Get single wall config
exports.getWallConfigBySlug = asyncHandler(async (req, res) => {
  const wall = await WallConfig.findOne({ slug: req.params.slug }).notDeleted().populate("business");
  if (!wall) return response(res, 404, "Wall configuration not found.");

  return response(res, 200, "Wall configuration retrieved.", {
    _id: wall._id,
    name: wall.name,
    slug: wall.slug,
    mode: wall.mode,
    business: wall.business
      ? {
          _id: wall.business._id,
          name: wall.business.name,
          slug: wall.business.slug,
        }
      : null,
    createdAt: wall.createdAt,
  });
});

exports.deleteWallConfig = asyncHandler(async (req, res) => {
  const config = await WallConfig.findById(req.params.id);
  if (!config) return response(res, 404, "Wall configuration not found.");

  await config.softDelete(req.user.id);
  return response(res, 200, "Wall configuration moved to recycle bin.");
});

exports.restoreWall = asyncHandler(async (req, res) => {
  const config = await WallConfig.findOneDeleted({ _id: req.params.id });
  if (!config) return response(res, 404, "Wall configuration not found in trash.");

  await config.restore();
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
  if (!config) return response(res, 404, "Wall configuration not found in trash.");

  await cascadePermanentDeleteWall(config._id);
  return response(res, 200, "Wall configuration permanently deleted.");
});

exports.restoreAllWalls = asyncHandler(async (req, res) => {
  const deletedWalls = await WallConfig.findDeleted();
  
  for (const wall of deletedWalls) {
    await wall.restore();
  }
  
  return response(res, 200, `${deletedWalls.length} wall configurations restored.`);
});

exports.permanentDeleteAllWalls = asyncHandler(async (req, res) => {
  const deletedWalls = await WallConfig.findDeleted();
  
  for (const wall of deletedWalls) {
    await cascadePermanentDeleteWall(wall._id);
  }
  
  return response(res, 200, `${deletedWalls.length} wall configurations permanently deleted.`);
});
