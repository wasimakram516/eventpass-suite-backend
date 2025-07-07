const GlobalConfig = require("../models/GlobalConfig");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../utils/uploadToCloudinary");

// Create Global Config
exports.createConfig = asyncHandler(async (req, res) => {
  const existing = await GlobalConfig.findOne();
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

  // Upload files
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

  // Construct object fields
  const config = await GlobalConfig.create({
    appName,
    contact: {
      email: contactEmail ?? "",
      phone: contactPhone ?? "",
    },
    support: {
      email: supportEmail ?? "",
      phone: supportPhone ?? "",
    },
    socialLinks: {
      facebook: facebook ?? "",
      instagram: instagram ?? "",
      linkedin: linkedin ?? "",
      website: website ?? "",
    },
    companyLogoUrl,
    brandingMediaUrl,
    poweredBy: {
      text: poweredByText ?? "",
      mediaUrl: poweredByMediaUrl,
    },
  });

  return response(res, 201, "Global configuration created", config);
});

// Get Global Config
exports.getConfig = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne();
  return response(res, 200, "Global configuration fetched", config);
});

// Update Global Config
exports.updateConfig = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne();
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

  config.contact = {
    email: contactEmail ?? "",
    phone: contactPhone ?? "",
  };

  config.support = {
    email: supportEmail ?? "",
    phone: supportPhone ?? "",
  };

  config.poweredBy = {
    ...config.poweredBy,
    text: poweredByText ?? "",
  };

  config.socialLinks = {
    facebook: facebook ?? "",
    instagram: instagram ?? "",
    linkedin: linkedin ?? "",
    website: website ?? "",
  };

  // Image uploads remain unchanged
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

// Delete Global Config
exports.deleteConfig = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne();
  if (!config) return response(res, 404, "Global configuration not found");

  await config.deleteOne();
  return response(res, 200, "Global configuration deleted");
});
