const FileResource = require("../models/FileResource");
const Business = require("../models/Business");
const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");
const { uploadToS3, deleteFromS3 } = require("../utils/s3Storage");
const { generateUniqueSlug, slugify } = require("../utils/slugGenerator");

// Create new file resource
exports.createFileResource = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { title, slug } = body;
  const businessSlug = body.businessSlug || req.query.businessSlug;

  if (!businessSlug || !req.file || !slug)
    return response(res, 400, "Missing required fields");

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  // Slugify the user-provided slug ONLY
  const cleanSlug = await generateUniqueSlug(FileResource, "slug", slugify(slug));

  const { key, fileUrl } = await uploadToS3(req.file, business.name);

  const payload = {
    title,
    slug: cleanSlug,
    fileKey: key,
    fileUrl,
    contentType: req.file.mimetype,
    businessId: business._id,
  };
  const fileResource = req.user
    ? await FileResource.createWithAuditUser(payload, req.user)
    : await FileResource.create(payload);

  const populated = await FileResource.findById(fileResource._id)
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 201, "File uploaded successfully", populated || fileResource);
});

// Update existing file resource (replace old file)
exports.updateFileResource = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, slug } = req.body;

  const fileResource = await FileResource.findById(id);
  if (!fileResource) return response(res, 404, "File not found");

  const business = await Business.findById(fileResource.businessId);
  if (!business) return response(res, 404, "Linked business not found");

  // Replace file if uploaded
  if (req.file) {
    await deleteFromS3(fileResource.fileKey);
    const { key, fileUrl } = await uploadToS3(req.file, business.name);
    fileResource.fileKey = key;
    fileResource.fileUrl = fileUrl;
    fileResource.contentType = req.file.mimetype;
  }

  if (title) fileResource.title = title;

  if (slug) {
    const cleanSlug = await generateUniqueSlug(FileResource, "slug", slugify(slug));
    fileResource.slug = cleanSlug;
  }

  if (req.user) fileResource.setAuditUser(req.user);
  await fileResource.save();

  const populated = await FileResource.findById(fileResource._id)
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 200, "File updated successfully", populated || fileResource);
});

// Get all files (optionally by businessSlug)
exports.getAllFiles = asyncHandler(async (req, res) => {
  const { businessSlug } = req.query;

  let filter = {};
  if (businessSlug) {
    const business = await Business.findOne({ slug: businessSlug });
    if (!business) return response(res, 404, "Business not found");
    filter.businessId = business._id;
  }

  const files = await FileResource.find(filter)
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ createdAt: -1 });

  return response(res, 200, "Fetched all files", files);
});

// Get file by ID
exports.getFileById = asyncHandler(async (req, res) => {
  const file = await FileResource.findById(req.params.id)
    .populate("businessId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!file) return response(res, 404, "File not found");
  return response(res, 200, "File found", file);
});

exports.getFileBySlug = asyncHandler(async (req, res) => {
  const slug = decodeURIComponent(req.params.slug);
  console.log("🔍 Incoming slug:", slug);

  const file = await FileResource.findOne({ slug: slug.trim() });
  if (!file) return response(res, 404, "File not found or removed");

  return response(res, 200, "File fetched successfully", file);
});

// Delete file permanently
exports.deleteFileResource = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const file = await FileResource.findById(id);
  if (!file) return response(res, 404, "File not found");

  await deleteFromS3(file.fileKey);
  await file.deleteOne();

  return response(res, 200, "File deleted successfully");
});
