const WallConfig = require("../../models/WallConfig");
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

  const business = await Business.findById(businessId);
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
  const configs = await WallConfig.find()
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
  const wall = await WallConfig.findOne({ slug: req.params.slug }).populate("business");
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

// Delete wall config
exports.deleteWallConfig = asyncHandler(async (req, res) => {
  const config = await WallConfig.findById(req.params.id);
  if (!config) return response(res, 404, "Wall configuration not found.");

  await config.deleteOne();
  return response(res, 200, "Wall configuration deleted.");
});
