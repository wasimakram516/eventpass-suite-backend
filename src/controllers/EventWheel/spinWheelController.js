const SpinWheel = require("../../models/SpinWheel");
const Business = require("../../models/Business");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const { generateUniqueSlug } = require("../../utils/slugGenerator");

// Create SpinWheel
exports.createSpinWheel = asyncHandler(async (req, res) => {
  const { business, title, slug, type } = req.body;

  if (!business || !title || !type) {
    return response(res, 400, "Missing required fields");
  }

  const existingBusiness = await Business.findById(business);
  if (!existingBusiness) {
    return response(res, 404, "Business not found");
  }

  const finalSlug = await generateUniqueSlug(SpinWheel, "slug", slug);

  let logoUrl = "", backgroundUrl = "";

  if (req.files?.logo) {
    const uploaded = await uploadToCloudinary(req.files.logo[0].buffer, req.files.logo[0].mimetype);
    logoUrl = uploaded.secure_url;
  }

  if (req.files?.background) {
    const uploaded = await uploadToCloudinary(req.files.background[0].buffer, req.files.background[0].mimetype);
    backgroundUrl = uploaded.secure_url;
  }

  const spinWheel = await SpinWheel.create({
    business,
    title,
    slug: finalSlug,
    type,
    logoUrl,
    backgroundUrl,
  });

  return response(res, 201, "SpinWheel created successfully", spinWheel);
});

// Get All SpinWheels
exports.getAllSpinWheels = asyncHandler(async (req, res) => {
  const wheels = await SpinWheel.find().populate("business", "name slug").sort({ createdAt: -1 });
  return response(res, 200, "Fetched all spin wheels", wheels);
});

// Get SpinWheel by ID
exports.getSpinWheelById = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id).populate("business", "name slug");
  if (!wheel) return response(res, 404, "SpinWheel not found");
  return response(res, 200, "SpinWheel found", wheel);
});

// Get SpinWheel by Slug
exports.getSpinWheelBySlug = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findOne({ slug: req.params.slug }).populate("business", "name slug");
  if (!wheel) return response(res, 404, "SpinWheel not found");
  return response(res, 200, "SpinWheel found", wheel);
});

// Update SpinWheel
exports.updateSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const { title, slug, type } = req.body;

  if (slug && slug !== wheel.slug) {
    wheel.slug = await generateUniqueSlug(SpinWheel, "slug", slug);
  }

  wheel.title = title || wheel.title;
  wheel.type = type || wheel.type;

  if (req.files?.logo) {
    if (wheel.logoUrl) await deleteImage(wheel.logoUrl);
    const uploaded = await uploadToCloudinary(req.files.logo[0].buffer, req.files.logo[0].mimetype);
    wheel.logoUrl = uploaded.secure_url;
  }

  if (req.files?.background) {
    if (wheel.backgroundUrl) await deleteImage(wheel.backgroundUrl);
    const uploaded = await uploadToCloudinary(req.files.background[0].buffer, req.files.background[0].mimetype);
    wheel.backgroundUrl = uploaded.secure_url;
  }

  await wheel.save();
  return response(res, 200, "SpinWheel updated successfully", wheel);
});

// Delete SpinWheel
exports.deleteSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.logoUrl) await deleteImage(wheel.logoUrl);
  if (wheel.backgroundUrl) await deleteImage(wheel.backgroundUrl);

  await wheel.deleteOne();
  return response(res, 200, "SpinWheel deleted successfully");
});
