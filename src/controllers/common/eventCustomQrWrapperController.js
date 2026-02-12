const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const mongoose = require("mongoose");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");

function parseJson(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toBool(v) {
  if (v === true || v === "true" || v === "1") return true;
  if (v === false || v === "false" || v === "0") return false;
  return false;
}

const moduleName = "EventCustomQr";

/**
 * PUT /eventreg/events/:id/custom-qr-wrapper or PUT /checkin/events/:id/custom-qr-wrapper
 * Expects eventType "public" for EventReg, "closed" for CheckIn.
 */
exports.updateEventCustomQrWrapper = (eventType) =>
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return response(res, 400, "Invalid Event ID");
    }

    const event = await Event.findById(id);
    if (!event || event.eventType !== eventType) {
      return response(res, 404, "Event not found");
    }

    const business = await Business.findById(event.businessId);
    const businessSlug = business?.slug || "unknown";

    if (!event.customQrWrapper) event.customQrWrapper = {};
    const wrapper = event.customQrWrapper;

    const payload = parseJson(req.body.customQrWrapper || req.body.defaultQrWrapper);
    const brandingItemsBeforeMerge = wrapper?.brandingMedia?.items
      ? wrapper.brandingMedia.items.map((it) => ({ _id: String(it._id), url: it.url }))
      : [];

    if (payload) {
      if (payload.logo && typeof payload.logo === "object") {
        wrapper.logo = { ...(wrapper.logo || {}), ...payload.logo };
        if (wrapper.logo.url === undefined) wrapper.logo.url = "";
      }
      if (payload.backgroundImage && typeof payload.backgroundImage === "object") {
        wrapper.backgroundImage = { ...(wrapper.backgroundImage || {}), ...payload.backgroundImage };
        if (wrapper.backgroundImage.url === undefined) wrapper.backgroundImage.url = "";
      }
      if (payload.brandingMedia && typeof payload.brandingMedia === "object") {
        const existing = wrapper.brandingMedia || {};
        const legacyItems = existing.url
          ? [{ url: existing.url, width: existing.width, height: existing.height, x: existing.x, y: existing.y }]
          : (existing.items || []);
        const payloadItems = Array.isArray(payload.brandingMedia.items) ? payload.brandingMedia.items : legacyItems;
        wrapper.brandingMedia = {
          items: payloadItems.filter((i) => i && i.url).map((i) => ({
            url: i.url,
            width: i.width !== undefined ? i.width : 200,
            height: i.height !== undefined ? i.height : 60,
            x: i.x !== undefined ? i.x : 50,
            y: i.y !== undefined ? i.y : 15,
          })),
        };
      }
      if (payload.qr && typeof payload.qr === "object") {
        wrapper.qr = { ...(wrapper.qr || {}), ...payload.qr };
      }
      if (Array.isArray(payload.customFields)) {
        wrapper.customFields = payload.customFields;
      }
    }

    if (req.files?.qrWrapperLogo) {
      if (wrapper?.logo?.url) {
        try {
          await deleteFromS3(wrapper.logo.url);
        } catch {}
      }
      const { fileUrl } = await uploadToS3(
        req.files.qrWrapperLogo[0],
        businessSlug,
        moduleName,
        { inline: true }
      );
      if (!wrapper.logo) wrapper.logo = {};
      wrapper.logo.url = fileUrl;
    }
    if (!req.files?.qrWrapperLogo && toBool(req.body.removeQrWrapperLogo) && wrapper?.logo?.url) {
      try {
        await deleteFromS3(wrapper.logo.url);
      } catch {}
      wrapper.logo = wrapper.logo || {};
      wrapper.logo.url = "";
    }

    if (req.files?.qrWrapperBackground) {
      if (wrapper?.backgroundImage?.url) {
        try {
          await deleteFromS3(wrapper.backgroundImage.url);
        } catch {}
      }
      const { fileUrl } = await uploadToS3(
        req.files.qrWrapperBackground[0],
        businessSlug,
        moduleName,
        { inline: true }
      );
      if (!wrapper.backgroundImage) wrapper.backgroundImage = {};
      wrapper.backgroundImage.url = fileUrl;
    }
    if (!req.files?.qrWrapperBackground && toBool(req.body.removeQrWrapperBackground) && wrapper?.backgroundImage?.url) {
      try {
        await deleteFromS3(wrapper.backgroundImage.url);
      } catch {}
      wrapper.backgroundImage = wrapper.backgroundImage || {};
      wrapper.backgroundImage.url = "";
    }

    const removeBrandingIds = parseJson(req.body.removeBrandingMediaIds);
    if (Array.isArray(removeBrandingIds) && removeBrandingIds.length) {
      const toRemove = new Set(removeBrandingIds.map(String));
      for (const it of brandingItemsBeforeMerge) {
        if (toRemove.has(it._id) && it.url) {
          try {
            await deleteFromS3(it.url);
          } catch {}
        }
      }
    }

    if (
      toBool(req.body.clearAllBrandingMedia) ||
      (Array.isArray(payload?.brandingMedia?.items) &&
        payload.brandingMedia.items.length === 0 &&
        brandingItemsBeforeMerge.length > 0)
    ) {
      for (const it of brandingItemsBeforeMerge) {
        if (it?.url) {
          try {
            await deleteFromS3(it.url);
          } catch {}
        }
      }
      if (!wrapper.brandingMedia) wrapper.brandingMedia = { items: [] };
      wrapper.brandingMedia.items = [];
    }

    if (req.files?.qrWrapperBrandingMedia?.length) {
      if (!wrapper.brandingMedia) wrapper.brandingMedia = { items: [] };
      if (!Array.isArray(wrapper.brandingMedia.items)) wrapper.brandingMedia.items = [];
      for (const file of req.files.qrWrapperBrandingMedia) {
        const { fileUrl } = await uploadToS3(file, businessSlug, moduleName, { inline: true });
        wrapper.brandingMedia.items.push({ url: fileUrl, width: 200, height: 60, x: 50, y: 15 });
      }
    }

    event.customQrWrapper = wrapper;
    await event.save();

    const populated = await Event.findById(event._id)
      .populate("createdBy", "name")
      .populate("updatedBy", "name");
    return response(res, 200, "Custom QR wrapper updated", populated || event);
  });
