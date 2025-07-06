const cloudinary = require("cloudinary").v2;
const env = require("../config/env");

// Configure Cloudinary
cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
});

/**
 * Delete Image from Cloudinary (Removes version number)
 * @param {string} imageUrl - Full Cloudinary image URL to delete
 */
const deleteImage = async (imageUrl) => {
  try {
    if (!imageUrl || typeof imageUrl !== "string") {
      console.warn("⚠️ Skipping Cloudinary deletion. Invalid imageUrl:", imageUrl);
      return;
    }

    const urlParts = imageUrl.split("/");
    const uploadIndex = urlParts.indexOf("upload");

    if (uploadIndex === -1 || uploadIndex + 1 >= urlParts.length) {
      console.warn("⚠️ Skipping Cloudinary deletion. Could not determine Public ID.");
      return;
    }

    // Extract everything after "upload/" and remove version prefix (vXXXXXXXXXX/)
    const publicIdWithVersion = urlParts.slice(uploadIndex + 1).join("/");
    const publicIdParts = publicIdWithVersion.split("/");

    // If version prefix exists (e.g., "v1739887737/"), remove it
    if (publicIdParts[0].startsWith("v") && !isNaN(publicIdParts[0].slice(1))) {
      publicIdParts.shift(); // Remove version prefix
    }

    const publicId = publicIdParts.join("/").split(".")[0]; // Remove file extension

    if (!publicId) {
      console.warn("⚠️ Skipping Cloudinary deletion. Could not extract Public ID.");
      return;
    }

    console.log(`🛑 Deleting image with Public ID: ${publicId}`);

    const result = await cloudinary.uploader.destroy(publicId, { invalidate: true });
    console.log(`✅ Cloudinary Response:`, result);

  } catch (error) {
    console.error("❌ Cloudinary Deletion Failed:", error);
  }
};

module.exports = { cloudinary, deleteImage };
