const multer = require("multer");

// Image formats
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

// Video formats
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

// Documents
const allowedPdfTypes = ["application/pdf"];
const allowedExcelTypes = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// Merge all
const allowedTypes = [
  ...allowedImageTypes,
  ...allowedVideoTypes,
  ...allowedPdfTypes,
  ...allowedExcelTypes,
];

// -------------------------------------
// Multer storage + file filter
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
  fileFilter,
});

module.exports = upload;
