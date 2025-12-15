const DisplayMedia = require("../../models/DisplayMedia");
const WallConfig = require("../../models/WallConfig");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");
const asyncHandler = require("../../middlewares/asyncHandler");
const { emitToRoom } = require("../../utils/socketUtils");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// Get all media
exports.getDisplayMedia = asyncHandler(async (req, res) => {
  const items = await DisplayMedia.find()
    .notDeleted()
    .sort({ createdAt: -1 })
    .populate("wall");
  return response(
    res,
    200,
    items.length ? "Media fetched." : "No media found.",
    items
  );
});

// Get one media item by ID
exports.getMediaById = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findById(req.params.id)
    .notDeleted()
    .populate("wall");
  if (!item) return response(res, 404, "Media not found.");
  return response(res, 200, "Media retrieved.", item);
});

// Create new media (linked to wall config via slug)
exports.createDisplayMedia = asyncHandler(async (req, res) => {
  const wallSlug = req.params.slug;
  const { imageUrl, text = "" } = req.body;

  if (!imageUrl) return response(res, 400, "Image URL is required.");
  if (!wallSlug) return response(res, 400, "Wall slug is required.");

  const wall = await WallConfig.findOne({ slug: wallSlug }).populate("business", "slug");
  if (!wall) return response(res, 404, "Wall configuration not found.");

  const business = await Business.findById(wall.business);
  if (!business) return response(res, 404, "Business not found.");

  const media = await DisplayMedia.create({
    imageUrl,
    text: wall.mode === "card" ? text : "",
    wall: wall._id,
  });

  const updatedMediaList = await DisplayMedia.find({ wall: wall._id }).sort({
    createdAt: -1,
  });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  // Fire background recompute
  recomputeAndEmit(wall.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Media created successfully.", media);
});

// Update media (image or text only)
exports.updateDisplayMedia = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findById(req.params.id);
  if (!item) return response(res, 404, "Media not found.");

  if (req.body.text !== undefined) item.text = req.body.text;

  if (req.body.imageUrl) {
    const wall = await WallConfig.findById(item.wall).populate("business", "slug");
    if (!wall) return response(res, 404, "Wall not found.");


    if (item.imageUrl && item.imageUrl !== req.body.imageUrl) {
      try {
        await deleteFromS3(item.imageUrl);
      } catch (err) {
        console.error("Failed to delete old image from S3:", err);
      }
    }
    item.imageUrl = req.body.imageUrl;
  }

  await item.save();

  const wall = await WallConfig.findById(item.wall);
  const updatedMediaList = await DisplayMedia.find({ wall: wall._id }).sort({
    createdAt: -1,
  });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  // Fire background recompute
  recomputeAndEmit(wall.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Media updated successfully.", item);
});

exports.deleteDisplayMedia = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findById(req.params.id);
  if (!item) return response(res, 404, "Media not found.");

  if (item.imageUrl) {
    try {
      await deleteFromS3(item.imageUrl);
    } catch (err) {
      console.error("Failed to delete image from S3:", err);
    }
  }

  await item.softDelete(req.user.id);

  const wall = await WallConfig.findById(item.wall);
  const updatedMediaList = await DisplayMedia.find({
    wall: wall._id,
    isDeleted: false,
  }).sort({ createdAt: -1 });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  // Fire background recompute
  recomputeAndEmit(wall.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Media moved to recycle bin.");
});

exports.restoreMedia = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findOneDeleted({ _id: req.params.id });
  if (!item) return response(res, 404, "Media not found in trash.");

  await item.restore();

  const wall = await WallConfig.findById(item.wall);
  const updatedMediaList = await DisplayMedia.find({
    wall: wall._id,
    isDeleted: false,
  }).sort({ createdAt: -1 });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  // Fire background recompute
  recomputeAndEmit(wall.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Media restored.", item);
});

exports.permanentDeleteMedia = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findOneDeleted({ _id: req.params.id });
  if (!item) return response(res, 404, "Media not found in trash.");

  if (item.imageUrl) await deleteFromS3(item.imageUrl);
  await item.deleteOne();

  const wall = await WallConfig.findById(item.wall);
  const updatedMediaList = await DisplayMedia.find({
    wall: wall._id,
    isDeleted: false,
  }).sort({ createdAt: -1 });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  // Fire background recompute
  recomputeAndEmit(wall.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Media permanently deleted.");
});

exports.restoreAllMedia = asyncHandler(async (req, res) => {
  const deletedMedia = await DisplayMedia.findDeleted();

  for (const media of deletedMedia) {
    await media.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `${deletedMedia.length} media items restored.`);
});

exports.permanentDeleteAllMedia = asyncHandler(async (req, res) => {
  const deletedMedia = await DisplayMedia.findDeleted();

  for (const media of deletedMedia) {
    if (media.imageUrl) await deleteFromS3(media.imageUrl);
    await media.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedMedia.length} media items permanently deleted.`
  );
});
