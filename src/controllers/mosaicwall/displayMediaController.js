const DisplayMedia = require("../../models/DisplayMedia");
const WallConfig = require("../../models/WallConfig");
const response = require("../../utils/response");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const asyncHandler = require("../../middlewares/asyncHandler");
const { emitToRoom } = require("../../utils/socketUtils");

// Get all media
exports.getDisplayMedia = asyncHandler(async (req, res) => {
  const items = await DisplayMedia.find()
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
  const item = await DisplayMedia.findById(req.params.id).populate("wall");
  if (!item) return response(res, 404, "Media not found.");
  return response(res, 200, "Media retrieved.", item);
});

// Create new media (linked to wall config via slug)
exports.createDisplayMedia = asyncHandler(async (req, res) => {
  const wallSlug = req.params.slug;
  const { text = "" } = req.body;

  if (!req.file) return response(res, 400, "Image file is required.");
  if (!wallSlug) return response(res, 400, "Wall slug is required.");

  const wall = await WallConfig.findOne({ slug: wallSlug });
  if (!wall) return response(res, 404, "Wall configuration not found.");

  const uploaded = await uploadToCloudinary(req.file.buffer, req.file.mimetype);

  const media = await DisplayMedia.create({
    imageUrl: uploaded.secure_url,
    text: wall.mode === "card" ? text : "",
    wall: wall._id,
  });

  const updatedMediaList = await DisplayMedia.find({ wall: wall._id }).sort({ createdAt: -1 });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  return response(res, 201, "Media created successfully.", media);
});

// Update media (image or text only)
exports.updateDisplayMedia = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findById(req.params.id);
  if (!item) return response(res, 404, "Media not found.");

  if (req.body.text !== undefined) item.text = req.body.text;

  if (req.file) {
    await deleteImage(item.imageUrl);
    const uploaded = await uploadToCloudinary(req.file.buffer, req.file.mimetype);
    item.imageUrl = uploaded.secure_url;
  }

  await item.save();

  const wall = await WallConfig.findById(item.wall);
  const updatedMediaList = await DisplayMedia.find({ wall: wall._id }).sort({ createdAt: -1 });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  return response(res, 200, "Media updated successfully.", item);
});

// Delete media
exports.deleteDisplayMedia = asyncHandler(async (req, res) => {
  const item = await DisplayMedia.findById(req.params.id);
  if (!item) return response(res, 404, "Media not found.");

  if (item.imageUrl) await deleteImage(item.imageUrl);
  await item.deleteOne();

  const wall = await WallConfig.findById(item.wall);
  const updatedMediaList = await DisplayMedia.find({ wall: wall._id }).sort({ createdAt: -1 });
  emitToRoom(wall.slug, "mediaUpdate", updatedMediaList);

  return response(res, 200, "Media deleted successfully.");
});
