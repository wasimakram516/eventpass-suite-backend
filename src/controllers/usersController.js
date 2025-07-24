const User = require("../models/User");
const Business = require("../models/Business");
const Game = require("../models/Game");
const Player = require("../models/Player");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const WalkIn = require("../models/WalkIn");
const Poll = require("../models/Poll");
const EventQuestion = require("../models/EventQuestion");
const Visitor = require("../models/Visitor");
const { deleteImage } = require("../config/cloudinary");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const sanitizeUser = require("../utils/sanitizeUser");

// Get all users
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().populate("business", "name slug logoUrl");

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
    ...Array.from(businessMap.values()).flatMap((group) => [group.owner, ...group.staff]),
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
    _id: { $ne: currentUserId } // Exclude current user
  })
  .populate("business", "name slug logoUrl")
  .sort({ createdAt: -1 });

  const safeUsers = users.map(user => sanitizeUser(user));
  return response(res, 200, "Business staff members fetched successfully", safeUsers);
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
    "name slug logoUrl"
  );
  if (!user) return response(res, 404, "User not found");
  return response(res, 200, "User found", sanitizeUser(user));
});

// Update user (admin)
exports.updateUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, businessId, modulePermissions } =
    req.body;
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  // Only admin can update other users
  user.name = name || user.name;
  user.email = email || user.email;
  user.role = role || user.role;
  user.password = password || user.password;

  if (businessId) {
    const business = await Business.findById(businessId);
    if (!business) return response(res, 400, "Invalid business ID");
    user.business = business._id;
  }

  if (Array.isArray(modulePermissions)) {
    user.modulePermissions = modulePermissions;
  }

  await user.save();
  return response(res, 200, "User updated", sanitizeUser(user));
});

// Delete user (soft delete)
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  const userId = user._id;

  // If user is a "business" role, delete all their businesses and related data
  if (user.role === "business") {
    const businesses = await Business.find({ owner: userId });

    for (const business of businesses) {
      const businessId = business._id;

      // Delete business logo if exists
      if (business.logoUrl) {
        await deleteImage(business.logoUrl);
      }

      // Delete Games & Players
      const games = await Game.find({ businessId });
      const gameIds = games.map((g) => g._id);
      await Player.deleteMany({ gameId: { $in: gameIds } });
      await Game.deleteMany({ _id: { $in: gameIds } });

      // Delete Events & Registrations & WalkIns
      const events = await Event.find({ businessId });
      const eventIds = events.map((e) => e._id);
      await WalkIn.deleteMany({ eventId: { $in: eventIds } });
      await Registration.deleteMany({ eventId: { $in: eventIds } });
      await Event.deleteMany({ _id: { $in: eventIds } });

      // Delete Polls & EventQuestions
      await Poll.deleteMany({ business: businessId });
      await EventQuestion.deleteMany({ business: businessId });

      // Pull this business from visitor histories
      await Visitor.updateMany(
        {},
        { $pull: { eventHistory: { business: businessId } } }
      );

      // Finally, delete the business
      await business.deleteOne();
    }
  } else {
  // If he is a staff user, so delete WalkIns scanned by this user
    await WalkIn.deleteMany({ scannedBy: userId });
  }

  // Finally, delete the user
  await user.deleteOne();

  return response(res, 200, "User and related associations deleted successfully");
});