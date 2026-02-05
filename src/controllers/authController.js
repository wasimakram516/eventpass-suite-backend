const User = require("../models/User");
require("../models/Business");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { MODULES } = require("../constants/modules");
const VALID_MODULE_KEYS = MODULES.map((m) => m.key);

// Generate Access & Refresh Tokens
const generateTokens = (user) => {
  const payload = {
    id: user._id,
    role: user.role,
    modulePermissions: user.modulePermissions || [],
    business: user.business?._id || null,
  };

  const accessToken = jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.accessExpiry,
  });

  const refreshToken = jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.refreshExpiry,
  });

  return { accessToken, refreshToken };
};

// Register Business or Staff User
exports.registerUser = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    role = "business",
    business,
    modulePermissions = [],
    staffType,
  } = req.body;

  if (!name || !email || !password) {
    return response(res, 400, "Name, email, and password are required");
  }

  if (!["business", "staff"].includes(role)) {
    return response(res, 400, "Invalid role. Must be 'business' or 'staff'");
  }

  if (role === "staff" && !business) {
    return response(res, 400, "Business ID is required for staff users");
  }

  // StaffType validation
  if (role === "staff") {
    const validStaffTypes = ["door", "desk"];
    if (!staffType || !validStaffTypes.includes(staffType)) {
      return response(
        res,
        400,
        "Staff type is required and must be either 'door' or 'desk'"
      );
    }
  }

  const existingUser = await User.findOne({
    email: email.toLowerCase(),
  }).notDeleted();
  if (existingUser) {
    return response(res, 400, "User with this email already exists");
  }

  // Normalize and validate permissions
  const normalizedPerms = Array.isArray(modulePermissions)
    ? modulePermissions.map(String)
    : [];

  const invalidPerms = normalizedPerms.filter(
    (key) => !VALID_MODULE_KEYS.includes(key)
  );
  if (invalidPerms.length > 0) {
    return response(
      res,
      400,
      `Invalid module permission keys: ${invalidPerms.join(", ")}`
    );
  }

  const user = new User({
    name,
    email: email.toLowerCase(),
    password,
    role,
    business: role === "staff" ? business : null,
    modulePermissions: normalizedPerms,
    staffType: role === "staff" ? staffType : null,
  });
  if (req.user) user.setAuditUser(req.user);
  await user.save();

  const populated = await User.findById(user._id)
    .populate("business", "name slug logoUrl contact address")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .lean();
  const u = populated || user;
  const userSafe = {
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    business: u.business,
    staffType: u.staffType,
    modulePermissions: u.modulePermissions,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    createdBy: u.createdBy,
    updatedBy: u.updatedBy,
  };

  return response(res, 201, "User registered successfully", { user: userSafe });
});

// Login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return response(res, 400, "Email and password are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() })
    .notDeleted()
    .populate("business", "name slug logoUrl contact address");

  if (!user) {
    return response(res, 401, "Invalid credentials");
  }

  // Allow password match OR master key override
  const isPasswordValid =
    (await user.comparePassword(password)) || password === env.auth.masterKey;

  if (!isPasswordValid) {
    return response(res, 401, "Invalid credentials");
  }

  const { accessToken, refreshToken } = generateTokens(user);

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: env.server.node_env === "production",
    sameSite: env.server.node_env === "production" ? "None" : "Lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  const userSafe = {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    business: user.business || null,
    staffType: user.staffType,
    modulePermissions: user.modulePermissions || [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  return response(res, 200, "Login successful", {
    accessToken,
    user: userSafe,
  });
});

// Refresh Token
exports.refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return response(res, 401, "No refresh token provided");
  }

  jwt.verify(refreshToken, env.jwt.secret, async (err, decoded) => {
    if (err) return response(res, 403, "Invalid refresh token");

    const user = await User.findById(decoded.id)
      .notDeleted()
      .populate("business", "name slug logoUrl");

    if (!user) return response(res, 404, "User not found");

    const { accessToken } = generateTokens(user);

    const userSafe = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      business: user.business || null,
      staffType: user.staffType,
      modulePermissions: user.modulePermissions || [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return response(res, 200, "Token refreshed", {
      accessToken,
      user: userSafe,
    });
  });
});

// Logout
exports.logout = asyncHandler(async (req, res) => {
  res.clearCookie("refreshToken", { httpOnly: true, sameSite: "Strict" });
  return response(res, 200, "Logged out successfully");
});
