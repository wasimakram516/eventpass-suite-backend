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
  client:{
    url: validateEnv("FRONTEND_BASE_URL"),
    surveyGuru: validateEnv("SURVEYGURU_PUBLIC_PATH"),
  },
  auth: {
    adminEmail: validateEnv("ADMIN_EMAIL"),
    adminPassword: validateEnv("ADMIN_PASSWORD"),
    masterKey: validateEnv("MASTER_KEY"),
  },
  notifications:{
    email:{
      emailUser: validateEnv("EMAIL_USER"),
      emailPass: validateEnv("EMAIL_PASS"),
    },
    whatsapp:{
      accountSid: validateEnv("TWILIO_ACCOUNT_SID"),
      authToken: validateEnv("TWILIO_AUTH_TOKEN"),
      whatsappFrom: validateEnv("TWILIO_WHATSAPP_FROM"), // e.g., 'whatsapp:+14155238886'
    }
  },
  cloudinary: {
    cloudName: validateEnv("CLOUDINARY_CLOUD_NAME"),
    apiKey: validateEnv("CLOUDINARY_API_KEY"),
    apiSecret: validateEnv("CLOUDINARY_API_SECRET"),
    folder: validateEnv("CLOUDINARY_FOLDER"),
  },
};

module.exports = env;
