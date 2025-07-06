const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const morgan = require("morgan");
const errorHandler = require("./middlewares/errorHandler");
const seedAdmin = require("./seeder/adminSeeder");

// Routes
const moduleRoutes = require("./routes/moduleRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const globalConfigRoutes = require("./routes/globalConfigRoutes");
const businessRoutes = require("./routes/businessRoutes");

const app = express();
app.use(morgan("dev"));

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
    ],
  })
);
app.use(express.json());
app.use(cookieParser());

// Database Connection & Admin Seeder
const initializeApp = async () => {
  try {
    await connectDB();
    await seedAdmin();
  } catch (error) {
    console.error("❌ Error initializing app:", error);
  }
};

initializeApp();

// Routes
app.use("/api/modules", moduleRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/global-config", globalConfigRoutes );
app.use("/api/businesses", businessRoutes );

// Health Check
app.get("/", (req, res) => {
  res.status(200).send("📡 Server is running...");
});

// Error Handler
app.use(errorHandler);

module.exports = app;
