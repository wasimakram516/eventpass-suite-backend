require("dotenv").config();

// Function to validate required environment variables
const validateEnv = (key) => {
  if (!process.env[key]) {
    throw new Error(
      `❌ Environment variable "${key}" is missing. Please define it in your .env.local file.`
    );
  }
  return process.env[key];
};

// Centralized Environment Configuration
const env = {
  database: {
    url: validateEnv("MONGO_URI"),
  },
  jwt: {
    secret: validateEnv("JWT_SECRET"),
    accessExpiry: validateEnv("JWT_ACCESS_EXPIRY"),
    refreshExpiry: validateEnv("JWT_REFRESH_EXPIRY"),
  },
  server: {
    port: validateEnv("PORT"),
    node_env: validateEnv("NODE_ENV"),
  },
  client: {
    url: validateEnv("FRONTEND_BASE_URL"),
    surveyGuru: validateEnv("SURVEYGURU_PUBLIC_PATH"),
  },
  auth: {
    adminEmail: validateEnv("ADMIN_EMAIL"),
    adminPassword: validateEnv("ADMIN_PASSWORD"),
    masterKey: validateEnv("MASTER_KEY"),
  },
  notifications: {
    email: {
      host: validateEnv("EMAIL_HOST"),
      port: validateEnv("EMAIL_PORT"),
      user: validateEnv("EMAIL_USER"),
      pass: validateEnv("EMAIL_PASS"),
      from: validateEnv("EMAIL_FROM"),
    },
  },
  cloudinary: {
    cloudName: validateEnv("CLOUDINARY_CLOUD_NAME"),
    apiKey: validateEnv("CLOUDINARY_API_KEY"),
    apiSecret: validateEnv("CLOUDINARY_API_SECRET"),
    folder: validateEnv("CLOUDINARY_FOLDER"),
  },
  aws: {
    region: validateEnv("AWS_REGION"),
    accessKeyId: validateEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: validateEnv("AWS_SECRET_ACCESS_KEY"),
    s3Bucket: validateEnv("S3_BUCKET"),
    cloudfrontUrl: validateEnv("CLOUDFRONT_URL"),
  },
  googleTranslate: {
    apiUrl: validateEnv("GOOGLE_API_URL"),
    apiKey: validateEnv("GOOGLE_TRANSLATE_API_KEY"),
  },
};

module.exports = env;
