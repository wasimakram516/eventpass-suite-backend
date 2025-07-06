const GlobalConfig = require("../models/GlobalConfig");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { uploadToCloudinary } = require("../utils/uploadToCloudinary");

// Create Global Config
exports.createConfig = asyncHandler(async (req, res) => {
  const existing = await GlobalConfig.findOne();
  if (existing) return response(res, 400, "Global configuration already exists");

  const {
    appName,
    contact,
    support,
    socialLinks,
  } = req.body;

  const poweredByText =
    req.body["poweredBy[text]"] ??
    req.body.poweredByText ??
    (req.body.poweredBy && req.body.poweredBy.text) ??
    "";

  let companyLogoUrl = "";
  let brandingMediaUrl = "";
  let poweredByMediaUrl = "";

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
    contact,
    support,
    socialLinks,
    companyLogoUrl,
    brandingMediaUrl,
    poweredBy: {
      text: poweredByText,
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
    contact,
    support,
    socialLinks,
  } = req.body;
  
  const poweredByText =
    req.body["poweredBy[text]"] ??
    req.body.poweredByText ??
    (req.body.poweredBy && req.body.poweredBy.text) ??
    "";

  if (appName) config.appName = appName;
  if (contact) config.contact = { ...config.contact, ...contact };
  if (support) config.support = { ...config.support, ...support };
  if (socialLinks) config.socialLinks = { ...config.socialLinks, ...socialLinks };
  if (poweredByText) config.poweredBy.text = poweredByText;

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
