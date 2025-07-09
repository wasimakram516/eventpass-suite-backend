const jwt = require("jsonwebtoken");
const env = require("../config/env");
const response = require("../utils/response");
const { MODULES } = require("../constants/modules"); 

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
 * Admin-Only Middleware
 */
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return response(res, 403, "Forbidden - Admins only");
  }

  next();
};

/**
 * Module Permission Middleware
 * Checks if user has access to a specific module
 */
const checkPermission = (moduleKey) => (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return response(res, 401, "Unauthorized - No user found");
    if (
      user.role === "admin" ||
      (user.modulePermissions && user.modulePermissions.includes(moduleKey))
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
  adminOnly,
  checkPermission,
};
