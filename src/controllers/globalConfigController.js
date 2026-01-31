const GlobalConfig = require("../models/GlobalConfig");
const response = require("../utils/response");
const asyncHandler = require("../middlewares/asyncHandler");
const { uploadToS3, deleteFromS3 } = require("../utils/s3Storage");

// ---------- helpers ----------
function parseJsonArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function stitchLogosFromFiles(files = [], meta = []) {
  return files.map((f, i) => {
    const m = meta[i] || {};
    return { name: m.name || "", website: m.website || "" };
  });
}

async function uploadManyToS3(files = [], businessSlug, moduleName) {
  const results = [];
  for (const f of files) {
    const { fileUrl } = await uploadToS3(f, businessSlug, moduleName, { inline: true });
    results.push(fileUrl);
  }
  return results;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1","true","on","yes"].includes(v.toLowerCase());
  return false;
}
// --------------------------------

// Create Global Config (allow only 1 active)
exports.createConfig = asyncHandler(async (req, res) => {
  const existing = await GlobalConfig.findOne({ isDeleted: false });
  if (existing) return response(res, 400, "Global configuration already exists");

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

  const businessSlug = "global";
  const moduleName = "GlobalConfig";

  // Upload single media (optional)
  if (req.files?.companyLogo) {
    const { fileUrl } = await uploadToS3(
      req.files.companyLogo[0],
      businessSlug,
      moduleName,
      { inline: true }
    );
    companyLogoUrl = fileUrl;
  }

  if (req.files?.brandingMedia) {
    const { fileUrl } = await uploadToS3(
      req.files.brandingMedia[0],
      businessSlug,
      moduleName,
      { inline: true }
    );
    brandingMediaUrl = fileUrl;
  }

  if (req.files?.poweredByMedia) {
    const { fileUrl } = await uploadToS3(
      req.files.poweredByMedia[0],
      businessSlug,
      moduleName,
      { inline: true }
    );
    poweredByMediaUrl = fileUrl;
  }

  // ---- client logos (files and/or direct URLs) ----
  const clientLogoFiles = req.files?.clientLogos || [];
  const clientLogosMeta = parseJsonArray(req.body.clientLogosMeta);
  const clientLogosFromFiles = stitchLogosFromFiles(clientLogoFiles, clientLogosMeta);

  let uploadedLogoUrls = [];
  if (clientLogoFiles.length) {
    uploadedLogoUrls = await uploadManyToS3(clientLogoFiles, businessSlug, moduleName);
  }
  const clientLogosFromUrls = parseJsonArray(req.body.clientLogosUrls); // [{logoUrl, name?, website?}, ...]

  const clientLogos = [
    ...clientLogosFromFiles.map((item, idx) => ({
      ...item,
      logoUrl: uploadedLogoUrls[idx] || ""
    })),
    ...clientLogosFromUrls.filter(x => x && x.logoUrl).map(x => ({
      name: x.name || "",
      website: x.website || "",
      logoUrl: x.logoUrl
    }))
  ];

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
    ...(clientLogos.length ? { clientLogos } : {})
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

    // removal flags
    removeCompanyLogo,
    removeBrandingMedia,
    removePoweredByMedia,
    clearAllClientLogos
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

  const businessSlug = "global";
  const moduleName = "GlobalConfig";

  // --- Replace uploads: delete old first, then upload new ---
  if (req.files?.companyLogo) {
    if (config.companyLogoUrl) {
      try { await deleteFromS3(config.companyLogoUrl); } catch {}
    }
    const { fileUrl } = await uploadToS3(
      req.files.companyLogo[0],
      businessSlug,
      moduleName,
      { inline: true }
    );
    config.companyLogoUrl = fileUrl;
  }

  if (req.files?.brandingMedia) {
    if (config.brandingMediaUrl) {
      try { await deleteFromS3(config.brandingMediaUrl); } catch {}
    }
    const { fileUrl } = await uploadToS3(
      req.files.brandingMedia[0],
      businessSlug,
      moduleName,
      { inline: true }
    );
    config.brandingMediaUrl = fileUrl;
  }

  if (req.files?.poweredByMedia) {
    if (config.poweredBy?.mediaUrl) {
      try { await deleteFromS3(config.poweredBy.mediaUrl); } catch {}
    }
    const { fileUrl } = await uploadToS3(
      req.files.poweredByMedia[0],
      businessSlug,
      moduleName,
      { inline: true }
    );
    config.poweredBy.mediaUrl = fileUrl;
  }

  // --- Removals via flags (only if NOT replaced above) ---
  if (!req.files?.companyLogo && toBool(removeCompanyLogo) && config.companyLogoUrl) {
    try { await deleteFromS3(config.companyLogoUrl); } catch {}
    config.companyLogoUrl = "";
  }
  if (!req.files?.brandingMedia && toBool(removeBrandingMedia) && config.brandingMediaUrl) {
    try { await deleteFromS3(config.brandingMediaUrl); } catch {}
    config.brandingMediaUrl = "";
  }
  if (!req.files?.poweredByMedia && toBool(removePoweredByMedia) && config.poweredBy?.mediaUrl) {
    try { await deleteFromS3(config.poweredBy.mediaUrl); } catch {}
    config.poweredBy.mediaUrl = "";
  }

  // -------- client logos: add / remove / clear / reorder ----------
  // (A) ADD from files + meta
  const addLogoFiles = req.files?.clientLogos || [];
  if (addLogoFiles.length && !toBool(clearAllClientLogos)) {
    const addMeta = parseJsonArray(req.body.clientLogosMeta);
    const base = stitchLogosFromFiles(addLogoFiles, addMeta);
    const urls = await uploadManyToS3(addLogoFiles, businessSlug, moduleName);
    base.forEach((b, i) => { b.logoUrl = urls[i] || ""; });
    config.clientLogos = [...(config.clientLogos || []), ...base];
  }

  // (B) ADD from direct URLs
  const clientLogosUrls = parseJsonArray(req.body.clientLogosUrls);
  if (clientLogosUrls.length && !toBool(clearAllClientLogos)) {
    const normalized = clientLogosUrls
      .filter(x => x && x.logoUrl)
      .map(x => ({ name: x.name || "", website: x.website || "", logoUrl: x.logoUrl }));
    config.clientLogos = [...(config.clientLogos || []), ...normalized];
  }

  // (C) REMOVE specific _ids → also delete from S3
  const removeLogoIds = parseJsonArray(req.body.removeLogoIds);
  if (removeLogoIds.length && Array.isArray(config.clientLogos)) {
    const toRemove = new Set(removeLogoIds.map(String));
    const remaining = [];
    for (const l of config.clientLogos) {
      if (toRemove.has(String(l._id))) {
        if (l.logoUrl) { try { await deleteFromS3(l.logoUrl); } catch {} }
        // skip (removed)
      } else {
        remaining.push(l);
      }
    }
    config.clientLogos = remaining;
  }

  // (D) CLEAR all client logos → delete all from S3
  if (toBool(clearAllClientLogos) && Array.isArray(config.clientLogos) && config.clientLogos.length) {
    for (const l of config.clientLogos) {
      if (l?.logoUrl) { try { await deleteFromS3(l.logoUrl); } catch {} }
    }
    config.clientLogos = [];
  }

  // (E) REORDER / FULL REPLACEMENT (no deletes implied)
  const reorderClientLogos = parseJsonArray(req.body.reorderClientLogos);
  if (reorderClientLogos.length) {
    config.clientLogos = reorderClientLogos.map(x => ({
      _id: x._id,
      name: x.name || "",
      website: x.website || "",
      logoUrl: x.logoUrl || ""
    }));
  }
  // --------------------------------------------------------

  await config.save();
  return response(res, 200, "Global configuration updated", config);
});

// Sync fonts from frontend
exports.syncFonts = asyncHandler(async (req, res) => {
  const { fonts } = req.body;
  
  if (!fonts || !Array.isArray(fonts)) {
    return response(res, 400, "Fonts array is required");
  }

  let config = await GlobalConfig.findOne({ isDeleted: false });
  
  if (!config) {
    config = await GlobalConfig.create({
      appName: "EventPass Suite",
      fonts: fonts
    });
  } else {
    config.fonts = fonts;
    await config.save();
  }

  return response(res, 200, "Fonts synced successfully", { fonts: config.fonts });
});

// Get fonts
exports.getFonts = asyncHandler(async (req, res) => {
  const config = await GlobalConfig.findOne({ isDeleted: false });
  const fonts = config?.fonts || [];
  return response(res, 200, "Fonts fetched successfully", { fonts });
});

// Soft delete (move to Recycle Bin) — keep assets; cleanup handled elsewhere if needed
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
