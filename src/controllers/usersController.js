const User = require("../models/User");
const Business = require("../models/Business");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const sanitizeUser = require("../utils/sanitizeUser");

// Get all users (admin)
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find()
    .populate("business", "name slug logoUrl")
    .sort({ createdAt: -1 });

  const safeUsers = users.map(sanitizeUser);

  return response(res, 200, "All users fetched", safeUsers);
});

// Get all staff members of business (excluding logged in business user)
exports.getAllStaffUsersByBusiness = asyncHandler(async (req, res) => {
  const businessId = req.user.business;
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

// Delete user (admin only)
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return response(res, 404, "User not found");

  await user.deleteOne();
  return response(res, 200, "User deleted");
});
