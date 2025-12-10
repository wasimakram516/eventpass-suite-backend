const AWS = require("aws-sdk");
const path = require("path");
const env = require("../config/env");

AWS.config.update({
  region: env.aws.region,
  accessKeyId: env.aws.accessKeyId,
  secretAccessKey: env.aws.secretAccessKey,
});

const s3 = new AWS.S3();

const getFolderPath = (businessSlug, moduleName, mimetype, originalname) => {
  let folder = "others";
  if (mimetype.startsWith("image/")) folder = "images";
  else if (mimetype.startsWith("video/")) folder = "videos";
  else if (mimetype === "application/pdf") folder = "pdfs";
  return `${businessSlug}/${moduleName}/${folder}/${Date.now()}_${path.basename(
    originalname
  )}`;
};

// Upload
exports.uploadToS3 = async (file, businessSlug, moduleName, options = {}) => {
  const key = getFolderPath(businessSlug, moduleName, file.mimetype, file.originalname);

  // Default to "attachment", but allow override
  const dispositionType = options.inline ? "inline" : "attachment";

  const params = {
    Bucket: env.aws.s3Bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ContentDisposition: `${dispositionType}; filename="${file.originalname}"`,
  };

  await s3.upload(params).promise();

  const fileUrl = `${env.aws.cloudfrontUrl}/${key}`;
  return { key, fileUrl };
};

// Generate presigned URL for direct frontend upload
exports.getPresignedUrl = (businessSlug, moduleName, fileName, fileType, options = {}) => {
  const key = getFolderPath(businessSlug, moduleName, fileType, fileName);
  const dispositionType = options.inline ? "inline" : "attachment";

  const params = {
    Bucket: env.aws.s3Bucket,
    Key: key,
    ContentType: fileType,
    ContentDisposition: `${dispositionType}; filename="${fileName}"`,
    Expires: 3600,
  };

  const uploadURL = s3.getSignedUrl("putObject", params);
  const fileUrl = `${env.aws.cloudfrontUrl}/${key}`;

  return { uploadURL, key, fileUrl };
};

// Delete (accepts URL or key)
exports.deleteFromS3 = async (fileKeyOrUrl) => {
  if (!fileKeyOrUrl) return;

  // Extract the actual key if URL provided
  let key = fileKeyOrUrl;
  if (fileKeyOrUrl.startsWith("http")) {
    try {
      const base = env.aws.cloudfrontUrl.endsWith("/")
        ? env.aws.cloudfrontUrl
        : env.aws.cloudfrontUrl + "/";
      key = decodeURIComponent(fileKeyOrUrl.replace(base, ""));
    } catch (err) {
      console.warn("Failed to extract S3 key from URL:", fileKeyOrUrl);
    }
  }

  const params = { Bucket: env.aws.s3Bucket, Key: key };

  try {
    await s3.deleteObject(params).promise();
    console.log("Deleted from S3:", key);
  } catch (err) {
    console.error("S3 delete error:", err.message);
  }
};
