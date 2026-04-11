const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const connectDB = require("./config/db");
const seedAdmin = require("./seeder/adminSeeder");
const { recalcMetrics } = require("./services/statsService");
const Business = require("./models/Business");
const errorHandler = require("./middlewares/errorHandler");
const response = require("./utils/response");

const allRoutes = require("./routes/index");
const logRoutes = require("./routes/logRoutes");
const app = express();
app.use(morgan("dev"));

// ------------------ CORS ------------------
const allowedOrigins = [
  "http://localhost:3000",
  "https://eventpass-whitewall.vercel.app",
  "https://www.whitewall.solutions",
  "https://whitewall.solutions",
  "https://eventpass.whitewall.solutions",
  "https://uat-eventpass-whitewall.vercel.app",
  "https://uat.eventpass.whitewall.solutions",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// ------------------ Database Init ------------------
(async () => {
  try {
    await connectDB();
    await seedAdmin();
    // Fire and forget — doesn't block the server from accepting requests
    warmDashboardCache();
  } catch (err) {
    console.error("Error initializing app:", err);
  }
})();

async function warmDashboardCache() {
  try {
    const businesses = await Business.find({ isDeleted: { $ne: true } }).select("_id").lean();
    await Promise.all([
      recalcMetrics("superadmin"),
      ...businesses.map((biz) => recalcMetrics("business", biz._id)),
    ]);
    console.log(`Dashboard cache warmed (${businesses.length} businesses)`);
  } catch (err) {
    console.error("Dashboard cache warm-up failed:", err.message);
  }
}

// ------------------ Centralized Routes ------------------
app.use("/api", allRoutes);

// ------------------ Health Check ------------------
app.get("/", (req, res) => {
  res.status(200).send("EventPass Suite Server is running...");
});

// ------------------ 404 & Error Handling ------------------
app.use((req, res) => response(res, 404, `Route not found: ${req.originalUrl}`));
app.use(errorHandler);
app.use("/api/logs", logRoutes);

module.exports = app;
