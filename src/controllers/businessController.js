const Business = require("../models/Business");
const User = require("../models/User");
const Game = require("../models/Game");
const GameSession = require("../models/GameSession");
const Player = require("../models/Player");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const SurveyForm = require("../models/SurveyForm");
const SurveyRecipient = require("../models/SurveyRecipient");
const SurveyResponse = require("../models/SurveyResponse");
const WalkIn = require("../models/WalkIn");
const Poll = require("../models/Poll");
const EventQuestion = require("../models/EventQuestion");
const Visitor = require("../models/Visitor");
const SpinWheel = require("../models/SpinWheel");
const SpinWheelParticipant = require("../models/SpinWheelParticipant");
const WallConfig = require("../models/WallConfig");
const DisplayMedia = require("../models/DisplayMedia");

const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../utils/uploadToCloudinary");
const { deleteImage } = require("../config/cloudinary");
const { generateUniqueSlug } = require("../utils/slugGenerator");
const { recomputeAndEmit } = require("../socket/dashboardSocket");

// Create Business
exports.createBusiness = asyncHandler(async (req, res) => {
  const { name, slug, phone, email, address, ownerId } = req.body;

  if (!name) return response(res, 400, "Business name is required");
  if (!ownerId) return response(res, 400, "Owner ID is required");

  const owner = await User.findById(ownerId).notDeleted();
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

  // Fire background recompute
  recomputeAndEmit(owner.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Business created successfully", business);
});

// Get All Businesses
exports.getAllBusinesses = asyncHandler(async (req, res) => {
  const businesses = await Business.find()
    .notDeleted()
    .populate("owner", "name email role")
    .sort({ createdAt: -1 });

  return response(res, 200, "Fetched all businesses", businesses);
});

// Get Business by ID (with owner populated)
exports.getBusinessById = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id)
    .notDeleted()
    .populate("owner", "name email role");

  if (!business) return response(res, 404, "Business not found");
  return response(res, 200, "Business found", business);
});

// Get Business by Slug (with owner populated)
exports.getBusinessBySlug = asyncHandler(async (req, res) => {
  const business = await Business.findOne({ slug: req.params.slug })
    .notDeleted()
    .populate("owner", "name email role");

  if (!business) return response(res, 404, "Business not found");
  return response(res, 200, "Business found", business);
});

// Update Business
exports.updateBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id).notDeleted();
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

  // Fire background recompute
  recomputeAndEmit(req.params.id || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Business updated successfully", business);
});

/* =========================================================
   Helper: Cascade delete everything linked to a business
   ========================================================= */
async function cascadeDeleteBusiness(businessId) {
  const business = await Business.findById(businessId);
  if (!business) return;

  // Delete logo
  if (business.logoUrl) {
    await deleteImage(business.logoUrl);
  }

  /** ===== Surveys ===== */
  const forms = await SurveyForm.find({ businessId });
  const formIds = forms.map((f) => f._id);
  if (formIds.length) {
    await SurveyResponse.deleteMany({ formId: { $in: formIds } });
    await SurveyRecipient.deleteMany({ formId: { $in: formIds } });
    await SurveyForm.deleteMany({ _id: { $in: formIds } });
  }

  /** ===== Games & Sessions ===== */
  const games = await Game.find({ businessId });
  const gameIds = games.map((g) => g._id);
  if (gameIds.length) {
    await GameSession.deleteMany({ gameId: { $in: gameIds } });
    await Player.deleteMany({}); // adjust if Player has businessId/gameId ref
    await Game.deleteMany({ _id: { $in: gameIds } });
  }

  /** ===== Events ===== */
  const events = await Event.find({ businessId });
  const eventIds = events.map((e) => e._id);
  if (eventIds.length) {
    await WalkIn.deleteMany({ eventId: { $in: eventIds } });
    await Registration.deleteMany({ eventId: { $in: eventIds } });
    await Event.deleteMany({ _id: { $in: eventIds } });
  }

  /** ===== Polls & Questions ===== */
  await Poll.deleteMany({ business: businessId });
  await EventQuestion.deleteMany({ business: businessId });

  /** ===== Visitors ===== */
  await Visitor.updateMany(
    {},
    { $pull: { eventHistory: { business: businessId } } }
  );
  await Visitor.deleteMany({ "eventHistory.business": businessId });

  /** ===== SpinWheels ===== */
  const wheels = await SpinWheel.find({ business: businessId });
  const wheelIds = wheels.map((w) => w._id);
  if (wheelIds.length) {
    await SpinWheelParticipant.deleteMany({ spinWheel: { $in: wheelIds } });
    await SpinWheel.deleteMany({ _id: { $in: wheelIds } });
  }

  /** ===== Walls ===== */
  const walls = await WallConfig.find({ business: businessId });
  const wallIds = walls.map((w) => w._id);
  if (wallIds.length) {
    await DisplayMedia.deleteMany({ wall: { $in: wallIds } });
    await WallConfig.deleteMany({ _id: { $in: wallIds } });
  }

  /** ===== Users ===== */
  await User.updateMany(
    { business: businessId, role: { $ne: "staff" } },
    { $set: { business: null } }
  );
  await User.deleteMany({ business: businessId, role: "staff" });

  // Finally, delete business itself
  await business.deleteOne();
}

/* =========================================================
   Controller Methods
   ========================================================= */

// Soft delete (Recycle Bin)
exports.deleteBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id);
  if (!business) return response(res, 404, "Business not found");

  await business.softDelete(req.user?.id);

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Business moved to Recycle Bin", business);
});

// Restore
exports.restoreBusiness = asyncHandler(async (req, res) => {
  const business = await Business.findById(req.params.id);
  if (!business) return response(res, 404, "Business not found");

  const conflict = await Business.findOne({
    _id: { $ne: business._id },
    slug: business.slug,
    isDeleted: false,
  });
  if (conflict) {
    return response(res, 409, "Cannot restore: slug already in use");
  }

  await business.restore();

  // Fire background recompute
  recomputeAndEmit(req.params.id || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Business restored successfully", business);
});

// Permanent delete single business
exports.permanentDeleteBusiness = asyncHandler(async (req, res) => {
  await cascadeDeleteBusiness(req.params.id);

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Business and related data permanently deleted");
});

// Restore all businesses
exports.restoreAllBusinesses = asyncHandler(async (req, res) => {
  const businesses = await Business.findDeleted();
  if (!businesses.length) return response(res, 404, "No businesses in trash");

  for (const b of businesses) {
    const conflict = await Business.findOne({
      _id: { $ne: b._id },
      slug: b.slug,
      isDeleted: false,
    });
    if (!conflict) {
      await b.restore();
    }
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${businesses.length} businesses`);
});

// Permanently delete all businesses
exports.permanentDeleteAllBusinesses = asyncHandler(async (req, res) => {
  const businesses = await Business.findDeleted();
  if (!businesses.length) return response(res, 404, "No businesses in trash");

  for (const b of businesses) {
    await cascadeDeleteBusiness(b._id);
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Permanently deleted ${businesses.length} businesses`
  );
});
