const AWS = require("aws-sdk");
const path = require("path");
const env = require("../config/env");

AWS.config.update({
  region: env.aws.region,
  accessKeyId: env.aws.accessKeyId,
  secretAccessKey: env.aws.secretAccessKey,
});

const s3 = new AWS.S3();

/**
 * Decide folder structure based on business name + file type
 * e.g. "Takaful Oman/pdfs/agenda.pdf"
 */
const getFolderPath = (businessName, mimetype, originalname) => {
  let folder = "others";
  if (mimetype.startsWith("image/")) folder = "images";
  else if (mimetype.startsWith("video/")) folder = "videos";
  else if (mimetype === "application/pdf") folder = "pdfs";
  else folder = "others";

  return `${businessName}/${folder}/${Date.now()}_${path.basename(originalname)}`;
};

/**
 * Upload file to S3 under structured path
 */
exports.uploadToS3 = async (file, businessName) => {
  const key = getFolderPath(businessName, file.mimetype, file.originalname);

  const params = {
    Bucket: env.aws.s3Bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    ContentDisposition: `attachment; filename="${file.originalname}"`,
  };

  await s3.upload(params).promise();

  const fileUrl = `${env.aws.cloudfrontUrl}/${key}`;
  return { key, fileUrl };
};

/**
 * Delete a file from S3 using its key
 */
exports.deleteFromS3 = async (fileKey) => {
  if (!fileKey) return;

  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: fileKey,
  };

  try {
    await s3.deleteObject(params).promise();
  } catch (err) {
    console.error("S3 delete error:", err.message);
  }
};
