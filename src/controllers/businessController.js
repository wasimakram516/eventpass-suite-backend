const Business = require("../models/Business");
const User = require("../models/User");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../utils/uploadToCloudinary");
const { deleteImage } = require("../config/cloudinary");
const { generateUniqueSlug } = require("../utils/slugGenerator");

// Create Business
exports.createBusiness = asyncHandler(async (req, res) => {
  const { name, slug, phone, email, address, ownerId } = req.body;

  if (!name) return response(res, 400, "Business name is required");
  if (!ownerId) return response(res, 400, "Owner ID is required");

  const owner = await User.findById(ownerId);
  if (!owner) return response(res, 404, "Owner (user) not found");

  const finalSlug = await generateUniqueSlug(Business, "slug", slug || name);

  let logoUrl = "";
  if (req.file) {
    const uploaded = await uploadToCloudinary(
      req.file.buffer,
      req.file.mimetype
    );
    logoUrl = uploaded.secure_url;
  }

  const structuredContact = {
    email: email || "",
    phone: phone || "",
  };

  const business = await Business.create({
    name,
    slug: finalSlug,
    logoUrl,
    contact: structuredContact,
    address,
    owner: owner._id,
  });

  owner.business = business._id;
  await owner.save();
  return response(res, 201, "Business created successfully", business);
});
// Get All Businesses
exports.getAllBusinesses = asyncHandler(async (req, res) => {
  const businesses = await Business
    .find()
    .populate("owner", "name email role")  
    .sort({ createdAt: -1 });

  return response(res, 200, "Fetched all businesses", businesses);
});

// Get Business by ID (with owner populated)
exports.getBusinessById = asyncHandler(async (req, res) => {
  const business = await Business
    .findById(req.params.id)
    .populate("owner", "name email role");

  if (!business) return response(res, 404, "Business not found");
  return response(res, 200, "Business found", business);
});

// Get Business by Slug (with owner populated)
exports.getBusinessBySlug = asyncHandler(async (req, res) => {
  const business = await Business
    .findOne({ slug: req.params.slug })
    .populate("owner", "name email role");

  if (!business) return response(res, 404, "Business not found");
  return response(res, 200, "Business found", business);
});

// Update Business
exports.updateBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id);
  if (!business) return response(res, 404, "Business not found");

  const { name, slug, email, phone, address } = req.body;

  // Update slug if changed
  if (slug && slug !== business.slug) {
    const finalSlug = await generateUniqueSlug(Business, "slug", slug);
    business.slug = finalSlug;
  }

  business.name = name || business.name;
  business.address = address || business.address;
  business.contact = {
    email: email || business.contact.email || "",
    phone: phone || business.contact.phone || "",
  };

  // Replace logo if a new file is uploaded
  if (req.file) {
    if (business.logoUrl) await deleteImage(business.logoUrl);
    const uploaded = await uploadToCloudinary(
      req.file.buffer,
      req.file.mimetype
    );
    business.logoUrl = uploaded.secure_url;
  }

  await business.save();
  return response(res, 200, "Business updated successfully", business);
});

// Delete Business
exports.deleteBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id);
  if (!business) return response(res, 404, "Business not found");

  if (business.logoUrl) {
    await deleteImage(business.logoUrl);
  }

  // Unlink the user who owned this business
  await User.findOneAndUpdate({ business: business._id }, { business: null });

  await business.deleteOne();
  return response(res, 200, "Business deleted successfully");
});
