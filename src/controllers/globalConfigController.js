// src/controllers/globalConfigController.js
const GlobalConfig = require("../models/GlobalConfig");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../utils/uploadToCloudinary");

// Create Global Config (allow only 1 active)
exports.createConfig = asyncHandler(async (req, res) => {
  // Only consider active (not deleted) configs
  const existing = await GlobalConfig.findOne({ isDeleted: false });
  if (existing)
    return response(res, 400, "Global configuration already exists");

  const {
    appName,
    contactEmail,
    contactPhone,
    supportEmail,
    supportPhone,
    facebook,
    instagram,
    linkedin,
    website,
    poweredByText,
  } = req.body;

  let companyLogoUrl = "";
  let brandingMediaUrl = "";
  let poweredByMediaUrl = "";

  // Upload files (optional)
  if (req.files?.companyLogo) {
    const uploaded = await uploadToCloudinary(
      req.files.companyLogo[0].buffer,
      req.files.companyLogo[0].mimetype
    );
    companyLogoUrl = uploaded.secure_url;
  }

  if (req.files?.brandingMedia) {
    const uploaded = await uploadToCloudinary(
      req.files.brandingMedia[0].buffer,
      req.files.brandingMedia[0].mimetype
    );
    brandingMediaUrl = uploaded.secure_url;
  }

  if (req.files?.poweredByMedia) {
    const uploaded = await uploadToCloudinary(
      req.files.poweredByMedia[0].buffer,
      req.files.poweredByMedia[0].mimetype
    );
    poweredByMediaUrl = uploaded.secure_url;
  }

  const config = await GlobalConfig.create({
    appName,
    contact: { email: contactEmail ?? "", phone: contactPhone ?? "" },
    support: { email: supportEmail ?? "", phone: supportPhone ?? "" },
    socialLinks: {
      facebook: facebook ?? "",
      instagram: instagram ?? "",
      linkedin: linkedin ?? "",
      website: website ?? "",
    },
    companyLogoUrl,
    brandingMediaUrl,
    poweredBy: { text: poweredByText ?? "", mediaUrl: poweredByMediaUrl },
  });

  return response(res, 201, "Global configuration created", config);
});

// Get the active Global Config (ignore trashed)
exports.getConfig = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne({ isDeleted: false });
  return response(res, 200, "Global configuration fetched", config);
});

// Update active Global Config
exports.updateConfig = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne({ isDeleted: false });
  if (!config) return response(res, 404, "Global configuration not found");

  const {
    appName,
    contactEmail,
    contactPhone,
    supportEmail,
    supportPhone,
    poweredByText,
    facebook,
    instagram,
    linkedin,
    website,
  } = req.body;

  if (appName !== undefined) config.appName = appName;

  config.contact = { email: contactEmail ?? "", phone: contactPhone ?? "" };
  config.support = { email: supportEmail ?? "", phone: supportPhone ?? "" };
  config.poweredBy = { ...config.poweredBy, text: poweredByText ?? "" };
  config.socialLinks = {
    facebook: facebook ?? "",
    instagram: instagram ?? "",
    linkedin: linkedin ?? "",
    website: website ?? "",
  };

  // Optional uploads
  if (req.files?.companyLogo) {
    const uploaded = await uploadToCloudinary(
      req.files.companyLogo[0].buffer,
      req.files.companyLogo[0].mimetype
    );
    config.companyLogoUrl = uploaded.secure_url;
  }

  if (req.files?.brandingMedia) {
    const uploaded = await uploadToCloudinary(
      req.files.brandingMedia[0].buffer,
      req.files.brandingMedia[0].mimetype
    );
    config.brandingMediaUrl = uploaded.secure_url;
  }

  if (req.files?.poweredByMedia) {
    const uploaded = await uploadToCloudinary(
      req.files.poweredByMedia[0].buffer,
      req.files.poweredByMedia[0].mimetype
    );
    config.poweredBy.mediaUrl = uploaded.secure_url;
  }

  await config.save();
  return response(res, 200, "Global configuration updated", config);
});

// Soft delete (move to Recycle Bin)
exports.deleteConfig = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne({ isDeleted: false });
  if (!config) return response(res, 404, "Global configuration not found");

  await config.softDelete(req.user?.id);
  return response(res, 200, "Global configuration moved to Recycle Bin");
});

// Restore most recent trashed config (guard against multiple actives)
exports.restoreConfig = asyncHandler(async (req, res) => {
  const active = await GlobalConfig.findOne({ isDeleted: false });
  if (active) {
    return response(
      res,
      409,
      "Cannot restore: an active global configuration already exists"
    );
  }

  // Restore latest trashed config (or you can target by ID if you add routes by ID)
  const trashed = await GlobalConfig.findOne({ isDeleted: true }).sort({
    deletedAt: -1,
  });
  if (!trashed)
    return response(res, 404, "No trashed configuration to restore");

  await trashed.restore();
  return response(res, 200, "Global configuration restored", trashed);
});

// Permanent delete (admin-only)
exports.permanentDeleteConfig = asyncHandler(async (req, res) => {
  // You can pick by ID if you prefer; here we delete the latest trashed one:
  const trashed = await GlobalConfig.findOne({ isDeleted: true }).sort({
    deletedAt: -1,
  });
  if (!trashed) return response(res, 404, "No trashed configuration found");

  await trashed.deleteOne();
  return response(res, 200, "Global configuration permanently deleted");
});
