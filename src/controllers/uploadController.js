const Business = require("../models/Business");
const User = require("../models/User");
const WallConfig = require("../models/WallConfig");
const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");
const { createPresignedUpload } = require("../utils/s3Storage");

const MODULE_CONFIGS = {
  checkin: { folderName: "CheckIn", permissionKey: "checkin" },
  digipass: { folderName: "DigiPass", permissionKey: "digipass" },
  eventduel: { folderName: "EventDuel", permissionKey: "eventduel" },
  eventreg: { folderName: "EventReg", permissionKey: "eventreg" },
  eventwheel: { folderName: "EventWheel", permissionKey: "eventwheel" },
  memorywall: {
    folderName: "MemoryWall",
    permissionKey: "memorywall",
    allowAnonymousWallUploads: true,
  },
  quiznest: { folderName: "QuizNest", permissionKey: "quiznest" },
  surveyguru: { folderName: "SurveyGuru", permissionKey: "surveyguru" },
  tapmatch: { folderName: "TapMatch", permissionKey: "tapmatch" },
  votecast: { folderName: "VoteCast", permissionKey: "votecast" },
};

const VALID_CONTENT_TYPE_REGEX = /^[\w.+-]+\/[\w.+-]+$/;

const normalizeModuleName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isPrivilegedRole = (role) =>
  role === "admin" || role === "superadmin";

const getCurrentUser = async (req) => {
  if (!req.user?.id) return null;

  return User.findById(req.user.id)
    .select("role modulePermissions business")
    .lean();
};

const requireModuleAccess = (user, permissionKey) => {
  if (!permissionKey) return;

  const role = String(user?.role || "").toLowerCase();
  if (role === "superadmin") return;

  const permissions = Array.isArray(user?.modulePermissions)
    ? user.modulePermissions
    : [];

  if (!permissions.includes(permissionKey)) {
    const err = new Error("You do not have permission to upload files here.");
    err.status = 403;
    throw err;
  }
};

const requireBusinessAccess = (user, businessId) => {
  if (isPrivilegedRole(String(user?.role || "").toLowerCase())) {
    return;
  }

  if (!user?.business || String(user.business) !== String(businessId)) {
    const err = new Error("You do not have access to upload files for this business.");
    err.status = 403;
    throw err;
  }
};

const validateMetadata = ({ fileName, fileType }) => {
  if (!fileName || typeof fileName !== "string") {
    return "fileName is required.";
  }

  if (fileName.length > 255) {
    return "fileName is too long.";
  }

  if (!fileType || typeof fileType !== "string") {
    return "fileType is required.";
  }

  if (!VALID_CONTENT_TYPE_REGEX.test(fileType)) {
    return "fileType is invalid.";
  }

  return null;
};

exports.authorizeUpload = asyncHandler(async (req, res) => {
  const {
    businessSlug,
    fileName,
    fileType,
    moduleName,
    wallSlug,
  } = req.body || {};

  const moduleConfig = MODULE_CONFIGS[normalizeModuleName(moduleName)];
  if (!moduleConfig) {
    return response(res, 400, "Unsupported upload module.");
  }

  const metadataError = validateMetadata({ fileName, fileType });
  if (metadataError) {
    return response(res, 400, metadataError);
  }

  let resolvedBusinessSlug = businessSlug;
  const isPublicWallUpload =
    moduleConfig.allowAnonymousWallUploads &&
    typeof wallSlug === "string" &&
    wallSlug.trim();

  if (isPublicWallUpload) {
    if (!fileType.startsWith("image/")) {
      return response(
        res,
        400,
        "Public MosaicWall uploads only support image files."
      );
    }

    const wall = await WallConfig.findOne({ slug: wallSlug })
      .populate("business", "slug")
      .lean();

    if (!wall?.business?.slug) {
      return response(res, 404, "Wall configuration not found.");
    }

    if (resolvedBusinessSlug && resolvedBusinessSlug !== wall.business.slug) {
      return response(
        res,
        400,
        "businessSlug does not match the requested wall."
      );
    }

    resolvedBusinessSlug = wall.business.slug;
  } else {
    if (!req.user) {
      return response(res, 401, "Authentication is required to upload files.");
    }

    if (!resolvedBusinessSlug || typeof resolvedBusinessSlug !== "string") {
      return response(res, 400, "businessSlug is required.");
    }

    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return response(res, 401, "Unauthorized - No user found.");
    }

    requireModuleAccess(currentUser, moduleConfig.permissionKey);

    const business = await Business.findOne({ slug: resolvedBusinessSlug })
      .select("_id slug")
      .lean();

    if (!business) {
      return response(res, 404, "Business not found.");
    }

    requireBusinessAccess(currentUser, business._id);
  }

  const uploadAuthorization = await createPresignedUpload({
    businessSlug: resolvedBusinessSlug,
    moduleName: moduleConfig.folderName,
    fileName,
    fileType,
    inline: true,
  });

  return response(res, 200, "Upload authorized.", uploadAuthorization);
});
