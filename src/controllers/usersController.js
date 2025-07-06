const User = require("../models/User");
const Business = require("../models/Business");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");

// Get all users (admin)
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find()
    .populate("business", "name slug logoUrl")
    .sort({ createdAt: -1 });

  return response(res, 200, "All users fetched", users);
});

// Get users without assigned business (for admin use)
exports.getUnassignedUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ role: "business", business: null });
  return response(res, 200, "Unassigned users fetched", users);
});

// Get user by ID
exports.getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate("business", "name slug logoUrl");
  if (!user) return response(res, 404, "User not found");
  return response(res, 200, "User found", user);
});

// Update user (admin)
exports.updateUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, businessId, modulePermissions } = req.body;
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
  return response(res, 200, "User updated", user);
});

// Delete user (admin only)
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  await user.deleteOne();
  return response(res, 200, "User deleted");
});

