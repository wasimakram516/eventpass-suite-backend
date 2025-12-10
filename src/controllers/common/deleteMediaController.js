const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { deleteImage } = require("../../config/cloudinary");
const mongoose = require("mongoose");

/**
 * Universal Media Deletion Controller
 */
exports.deleteMedia = asyncHandler(async (req, res) => {
  const {
    fileUrl,
    storageType = "s3",
    eventId,
    mediaType,
    eventType = "public",
    removeBrandingLogoIds,
  } = req.body;

  if (!fileUrl) {
    return response(res, 400, "File URL is required");
  }

  try {
    if (storageType === "s3") {
      await deleteFromS3(fileUrl);
    } else if (storageType === "cloudinary") {
      await deleteImage(fileUrl);
    } else {
      return response(res, 400, "Invalid storage type. Use 's3' or 'cloudinary'");
    }

    if (eventId && mediaType && mongoose.Types.ObjectId.isValid(eventId)) {
      const Event = require("../../models/Event");
      const event = await Event.findById(eventId);

      if (!event) {
        return response(res, 404, "Event not found");
      }

      const updates = {};

      if (mediaType === "logo") {
        updates.logoUrl = null;
      } else if (mediaType === "backgroundEn") {
        updates.background = {
          ...(event.background || {}),
          en: null,
        };
      } else if (mediaType === "backgroundAr") {
        updates.background = {
          ...(event.background || {}),
          ar: null,
        };
      } else if (mediaType === "brandingLogo") {
        const removeIds = removeBrandingLogoIds || [];
        if (removeIds.length && Array.isArray(removeIds)) {
          const existingBranding = event.brandingMedia || [];
          const removeIdsSet = new Set(removeIds.map(String));

          for (const media of existingBranding) {
            if (removeIdsSet.has(String(media._id)) && media.logoUrl) {
              try {
                await deleteFromS3(media.logoUrl);
              } catch (err) {
                console.error("Failed to delete branding logo from S3:", err);
              }
            }
          }

          updates.brandingMedia = existingBranding.filter(
            (media) => !removeIdsSet.has(String(media._id))
          );
        }
      } else if (mediaType === "agenda") {
        updates.agendaUrl = null;
      }

      if (Object.keys(updates).length > 0) {
        const updatedEvent = await Event.findByIdAndUpdate(eventId, updates, {
          new: true,
        });
        return response(res, 200, "Media deleted successfully", updatedEvent);
      }
    }

    return response(res, 200, "Media deleted successfully");
  } catch (error) {
    console.error("Media deletion error:", error);
    return response(res, 500, "Failed to delete media", null, error.message);
  }
});

