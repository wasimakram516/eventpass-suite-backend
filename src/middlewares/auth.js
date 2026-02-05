const jwt = require("jsonwebtoken");
const env = require("../config/env");
const response = require("../utils/response");
const { MODULES } = require("../constants/modules");
const User = require("../models/User");

/**
 * Auth Middleware: protect
 * Verifies JWT and attaches user info to req.user
 */
const protect = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return response(res, 401, "Unauthorized - No token provided");

    const decoded = jwt.verify(token, env.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    return response(
      res,
      401,
      "Unauthorized - Invalid token",
      null,
      error.message
    );
  }
};

/**
 * Optional Auth: if a valid JWT is present, set req.user; otherwise continue without it.
 * Use for routes that work for both anonymous and logged-in users (e.g. create registration).
 */
const optionalProtect = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return next();

    const decoded = jwt.verify(token, env.jwt.secret);
    req.user = decoded;
    next();
  } catch {
    next();
  }
};

/**
 * Admin-Only Middleware (allows both superadmin and admin)
 */
const adminOnly = (req, res, next) => {
  if (
    !req.user ||
    (req.user.role !== "superadmin" && req.user.role !== "admin")
  ) {
    return response(res, 403, "Forbidden - Admins only");
  }

  next();
};

/**
 * Super Admin-Only Middleware
 */
const superAdminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "superadmin") {
    return response(res, 403, "Forbidden - Super Admin only");
  }

  next();
};

/**
 * Module Permission Middleware
 * Checks if user has access to a specific module.
 * Superadmin: full access. Admin: only if module is in their (DB-fresh) modulePermissions.
 */
const checkPermission = (moduleKey) => async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return response(res, 401, "Unauthorized - No user found");
    const role = (user.role || "").toLowerCase();
    if (role === "superadmin") return next();

    if (role === "admin") {
      const fresh = await User.findById(user.id)
        .select("modulePermissions")
        .lean();
      const perms = fresh?.modulePermissions || [];
      if (perms.includes(moduleKey)) return next();
      return response(
        res,
        403,
        "Forbidden - No permission to access this module"
      );
    }

    if (
      user.modulePermissions &&
      user.modulePermissions.includes(moduleKey)
    ) {
      return next();
    }

    return response(
      res,
      403,
      "Forbidden - No permission to access this module"
    );
  } catch (err) {
    return response(res, 500, "Permission check failed", null, err.message);
  }
};

MODULES.forEach(({ key }) => {
  checkPermission[key] = checkPermission(key);
});

module.exports = {
  protect,
  optionalProtect,
  adminOnly,
  superAdminOnly,
  checkPermission,
};
