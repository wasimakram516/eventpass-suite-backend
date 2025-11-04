const env = require("../config/env");
const { cloudinary } = require("../config/cloudinary");
const streamifier = require("streamifier");

/**
 * Upload images, videos, and PDFs to Cloudinary with correct resource type.
 * Ensures PDFs are stored as real PDFs and served with Content-Type: application/pdf
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} mimetype - The MIME type of the file
 */
const uploadToCloudinary = async (fileBuffer, mimetype, customFolder = null) => {
  return new Promise((resolve, reject) => {
    let resourceType = "image";
    let folderName = customFolder || "images";
    const options = {
      folder: `${env.cloudinary.folder}/${folderName}`,
      resource_type: "image",
    };

    if (mimetype.startsWith("video")) {
      resourceType = "video";
      folderName = customFolder || "videos";
      options.folder = `${env.cloudinary.folder}/${folderName}`;
      options.resource_type = "video";
    } else if (mimetype.includes("pdf")) {
      resourceType = "auto";
      folderName = customFolder || "pdfs";
      options.folder = `${env.cloudinary.folder}/${folderName}`;
    }

    console.log(
      `📤 Uploading file to Cloudinary: /${folderName}`
    );

    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          console.error("❌ Cloudinary Upload Error:", error);
          return reject(error);
        }
        console.log(`✅ Cloudinary Upload Success: ${result.secure_url}`);
        resolve(result);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

module.exports = { uploadToCloudinary };
