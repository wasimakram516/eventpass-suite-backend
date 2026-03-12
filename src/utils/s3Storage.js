const AWS = require("aws-sdk");
const path = require("path");
const env = require("../config/env");

AWS.config.update({
  region: env.aws.region,
  accessKeyId: env.aws.accessKeyId,
  secretAccessKey: env.aws.secretAccessKey,
});

const s3 = new AWS.S3();

const S3_SIGNED_UPLOAD_TTL_SECONDS = 300;

const normalizeBaseUrl = (value = "") => value.replace(/\/+$/, "");

const sanitizePathSegment = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";

const sanitizeFileName = (value) =>
  path
    .basename(String(value || "file"))
    .replace(/[^a-zA-Z0-9._-]/g, "_") || "file";

const getFolderName = (mimetype = "") => {
  if (mimetype.startsWith("image/")) return "images";
  if (mimetype.startsWith("video/")) return "videos";
  if (mimetype === "application/pdf") return "pdfs";
  return "others";
};

const getFolderPath = (businessSlug, moduleName, mimetype, originalname) => {
  const safeBusinessSlug = sanitizePathSegment(businessSlug);
  const safeModuleName = sanitizePathSegment(moduleName);
  const safeFileName = sanitizeFileName(originalname);

  return `${safeBusinessSlug}/${safeModuleName}/${getFolderName(
    mimetype
  )}/${Date.now()}_${safeFileName}`;
};

const buildS3Url = (key) =>
  `https://${env.aws.s3Bucket}.s3.${env.aws.region}.amazonaws.com/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

const buildFileUrl = (key) => {
  const cloudfrontBase = normalizeBaseUrl(env.aws.cloudfrontUrl || "");
  if (cloudfrontBase) {
    return `${cloudfrontBase}/${key}`;
  }
  return buildS3Url(key);
};

const extractKeyFromUrl = (fileKeyOrUrl) => {
  if (!fileKeyOrUrl || !fileKeyOrUrl.startsWith("http")) {
    return fileKeyOrUrl;
  }

  const cloudfrontBase = normalizeBaseUrl(env.aws.cloudfrontUrl || "");
  if (cloudfrontBase && fileKeyOrUrl.startsWith(`${cloudfrontBase}/`)) {
    return decodeURIComponent(fileKeyOrUrl.slice(cloudfrontBase.length + 1));
  }

  const s3Base = normalizeBaseUrl(buildS3Url(""));
  if (s3Base && fileKeyOrUrl.startsWith(`${s3Base}/`)) {
    return decodeURIComponent(fileKeyOrUrl.slice(s3Base.length + 1));
  }

  try {
    const parsed = new URL(fileKeyOrUrl);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch (err) {
    console.warn("Failed to extract S3 key from URL:", fileKeyOrUrl);
    return fileKeyOrUrl;
  }
};

const buildContentDisposition = (fileName, inline = false) => {
  const dispositionType = inline ? "inline" : "attachment";
  return `${dispositionType}; filename="${sanitizeFileName(fileName)}"`;
};

const createPresignedUpload = async ({
  businessSlug,
  moduleName,
  fileName,
  fileType,
  inline = true,
  expiresIn = S3_SIGNED_UPLOAD_TTL_SECONDS,
}) => {
  const key = getFolderPath(businessSlug, moduleName, fileType, fileName);
  const contentDisposition = buildContentDisposition(fileName, inline);

  const params = {
    Bucket: env.aws.s3Bucket,
    Key: key,
    ContentType: fileType,
    ContentDisposition: contentDisposition,
    Expires: expiresIn,
  };

  const uploadUrl = await s3.getSignedUrlPromise("putObject", params);

  return {
    uploadUrl,
    key,
    fileUrl: buildFileUrl(key),
    headers: {
      "Content-Type": fileType,
      "Content-Disposition": contentDisposition,
    },
    expiresIn,
  };
};

const uploadToS3 = async (file, businessSlug, moduleName, options = {}) => {
  const key = getFolderPath(
    businessSlug,
    moduleName,
    file.mimetype,
    file.originalname
  );
  const contentDisposition = buildContentDisposition(
    file.originalname,
    options.inline
  );

  await s3
    .upload({
      Bucket: env.aws.s3Bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: contentDisposition,
    })
    .promise();

  return { key, fileUrl: buildFileUrl(key) };
};

const deleteFromS3 = async (fileKeyOrUrl) => {
  if (!fileKeyOrUrl) return;

  const key = extractKeyFromUrl(fileKeyOrUrl);

  try {
    await s3.deleteObject({ Bucket: env.aws.s3Bucket, Key: key }).promise();
    console.log("Deleted from S3:", key);
  } catch (err) {
    console.error("S3 delete error:", err.message);
  }
};

module.exports = {
  createPresignedUpload,
  deleteFromS3,
  uploadToS3,
};
