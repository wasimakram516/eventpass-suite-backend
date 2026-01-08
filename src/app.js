const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const connectDB = require("./config/db");
const seedAdmin = require("./seeder/adminSeeder");
const errorHandler = require("./middlewares/errorHandler");
const response = require("./utils/response");

const allRoutes = require("./routes/index");

const app = express();
app.use(morgan("dev"));

// ------------------ CORS ------------------
const allowedOrigins = [
  "http://localhost:3000",
  "https://eventpass-whitewall.vercel.app",
  "https://www.whitewall.solutions",
  "https://whitewall.solutions", 
  "https://eventpass.whitewall.solutions",
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
  } catch (err) {
    console.error("Error initializing app:", err);
  }
})();

// ------------------ Centralized Routes ------------------
app.use("/api", allRoutes);

// ------------------ Health Check ------------------
app.get("/", (req, res) => {
  res.status(200).send("EventPass Suite Server is running...");
});

// ------------------ 404 & Error Handling ------------------
app.use((req, res) => response(res, 404, `Route not found: ${req.originalUrl}`));
app.use(errorHandler);

module.exports = app;
