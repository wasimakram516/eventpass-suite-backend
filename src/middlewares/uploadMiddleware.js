const multer = require("multer");

// All image types
const allowedImageTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
];

// All video types
const allowedVideoTypes = [
  "video/mp4",
  "video/mpeg",
  "video/quicktime", // MOV
  "video/x-msvideo", // AVI
  "video/x-ms-wmv", // WMV
  "video/x-flv", // FLV
  "video/x-matroska", // MKV
  "video/webm",
  "video/3gpp",
  "video/3gpp2",
  "video/x-m4v",
];

// Document types
const allowedPdfTypes = ["application/pdf"];
const allowedExcelTypes = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const allowedTypes = [
  ...allowedImageTypes,
  ...allowedVideoTypes,
  ...allowedPdfTypes,
  ...allowedExcelTypes,
];

// -------------------------------------
// Multer storage + filter
// -------------------------------------
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!allowedTypes.includes(file.mimetype)) {
    console.warn(`❌ Rejected file: ${file.originalname} (${file.mimetype})`);
    return cb(
      new Error(
        "Invalid file type. Only images, videos, PDFs, and Excel/CSV files are allowed."
      ),
      false
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // Allow up to 100 MB per file
  fileFilter,
});

module.exports = upload;
