const User = require("../models/User");
const Business = require("../models/Business");
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

const { deleteFromS3 } = require("../utils/s3Storage");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const sanitizeUser = require("../utils/sanitizeUser");
const { emitUpdate } = require("./../utils/socketUtils");
const { recomputeAndEmit } = require("../socket/dashboardSocket");

// Get all users
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find()
    .notDeleted()
    .populate("business", "name slug logoUrl contact address");

  const admins = [];
  const businessMap = new Map();
  const orphanStaff = [];

  for (const user of users) {
    if (user.role === "admin") {
      admins.push(user);
    } else if (user.role === "business") {
      businessMap.set(user._id.toString(), { owner: user, staff: [] });
    } else if (user.role === "staff") {
      const businessId = user.business?._id?.toString();
      if (businessId && businessMap.has(businessId)) {
        businessMap.get(businessId).staff.push(user);
      } else {
        orphanStaff.push(user);
      }
    }
  }

  // Now prepare final list
  const groupedUsers = [
    ...admins,
    ...Array.from(businessMap.values()).flatMap((group) => [
      group.owner,
      ...group.staff,
    ]),
    ...orphanStaff,
  ];

  const safeUsers = groupedUsers.map(sanitizeUser);

  return response(res, 200, "All users fetched", safeUsers);
});

// Get all staff members of business (excluding logged in business user)
exports.getAllStaffUsersByBusiness = asyncHandler(async (req, res) => {
  const businessId = req.params.businessId;
  const currentUserId = req.user.id; // ID of the logged-in user

  if (!businessId) {
    return response(res, 400, "User is not associated with any business");
  }

  // Verify the business exists
  const businessExists = await Business.exists({ _id: businessId });
  if (!businessExists) {
    return response(res, 404, "Associated business not found in database");
  }

  // Find all users in the same business EXCEPT the current user
  const users = await User.find({
    business: businessId,
    role: "staff", // Only fetch staff members
    _id: { $ne: currentUserId }, // Exclude current user
  })
    .populate("business", "name slug logoUrl contact address")
    .sort({ createdAt: -1 });

  const safeUsers = users.map((user) => sanitizeUser(user));
  return response(
    res,
    200,
    "Business staff members fetched successfully",
    safeUsers
  );
});

// Get users without assigned business (for admin use)
exports.getUnassignedUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ role: "business", business: null });
  const safeUsers = users.map(sanitizeUser);
  return response(res, 200, "Unassigned users fetched", safeUsers);
});

// Get user by ID
exports.getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate(
    "business",
    "name slug logoUrl contact address"
  );
  if (!user) return response(res, 404, "User not found");
  return response(res, 200, "User found", sanitizeUser(user));
});

// Update user (admin)
exports.updateUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    businessId,
    modulePermissions,
    staffType,
  } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  // Update basic info
  if (name) user.name = name;
  if (email) user.email = email;
  if (password) user.password = password;
  if (role) user.role = role;

  // Staff type handling
  if (user.role === "staff") {
    if (staffType) user.staffType = staffType;
  } else {
    user.staffType = null;
  }

  if (businessId) {
    const business = await Business.findById(businessId);
    if (!business) return response(res, 400, "Invalid business ID");
    user.business = business._id;
  }

  if (Array.isArray(modulePermissions)) {
    user.modulePermissions = modulePermissions;
  }

  await user.save();
  // Fire background recompute
  recomputeAndEmit(user.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "User updated", sanitizeUser(user));
});

/* =========================================================
   Helper: Cascade delete everything linked to a business user
   ========================================================= */
async function cascadeDeleteUser(userId) {
  const user = await User.findById(userId);
  if (!user) return;

  if (user.role === "business") {
    const businesses = await Business.find({ owner: userId });

    for (const business of businesses) {
      const businessId = business._id;

      // Delete business logo if exists
      if (business.logoUrl) {
        await deleteFromS3(business.logoUrl);
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
        await Player.deleteMany({});
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

      /** ===== Polls & Event Questions ===== */
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

      /** ===== Users tied to this business ===== */
      await User.updateMany(
        { business: businessId, role: { $ne: "staff" } },
        { $set: { business: null } }
      );
      await User.deleteMany({ business: businessId, role: "staff" });

      // Finally, delete business itself
      await business.deleteOne();
    }
  } else {
    // staff → remove walk-ins they scanned
    await WalkIn.deleteMany({ scannedBy: user._id });
  }

  // Delete the user itself
  await user.deleteOne();
}

/* =========================================================
   User Controller Methods
   ========================================================= */

// Soft delete user
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  await user.softDelete(req.user?.id);

  // Fire background recompute
  recomputeAndEmit(user.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "User moved to Recycle Bin", user);
});

// Restore single user
exports.restoreUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  // Prevent email conflict
  const conflict = await User.findOne({
    _id: { $ne: user._id },
    email: user.email,
    isDeleted: false,
  });
  if (conflict) {
    return response(res, 409, "Cannot restore: email already in use");
  }

  await user.restore();

  // Fire background recompute
  recomputeAndEmit(user.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "User restored successfully", user);
});

// Permanent delete single user
exports.permanentDeleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  await cascadeDeleteUser(req.params.id);

  // Fire background recompute
  recomputeAndEmit(user.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "User and related data permanently deleted");
});

// Restore all users
exports.restoreAllUsers = asyncHandler(async (req, res) => {
  const users = await User.findDeleted();
  if (!users.length) return response(res, 404, "No users in trash");

  for (const u of users) {
    const conflict = await User.findOne({
      _id: { $ne: u._id },
      email: u.email,
      isDeleted: false,
    });
    if (!conflict) {
      await u.restore();
    }
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${users.length} users`);
});

// Permanent delete all users
exports.permanentDeleteAllUsers = asyncHandler(async (req, res) => {
  const users = await User.findDeleted();
  if (!users.length) return response(res, 404, "No users in trash");

  for (const u of users) {
    await cascadeDeleteUser(u._id);
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Permanently deleted ${users.length} users`);
});
