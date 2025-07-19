const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const morgan = require("morgan");
const errorHandler = require("./middlewares/errorHandler");
const seedAdmin = require("./seeder/adminSeeder");
const response = require("./utils/response");

// Routes
const moduleRoutes = require("./routes/moduleRoutes");
const translateRoutes = require("./routes/translateRoutes");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const globalConfigRoutes = require("./routes/globalConfigRoutes");
const businessRoutes = require("./routes/businessRoutes");
const gameRoutes = require("./routes/quiznest/gameRoutes");
const playerRoutes = require("./routes/quiznest/playerRoutes");
const questionRoutes = require("./routes/quiznest/questionRoutes");
const pollRoutes = require("./routes/votecast/pollRoutes");
const eventRegEventRoutes = require("./routes/EventReg/eventRoutes");
const eventRegRegistrationRoutes = require("./routes/EventReg/registrationRoutes");
const CheckInEventRoutes = require("./routes/CheckIn/eventRoutes");
const CheckInRegistrationRoutes = require("./routes/CheckIn/registrationRoutes");
const stageqQuestionRoutes = require("./routes/stageq/questionRoutes");
const stageqVisitorRoutes = require("./routes/stageq/visitorRoutes");
const mosaicWallWallConfigRoutes = require("./routes/mosaicwall/wallConfigRoutes");
const mosaicWallDisplayMediaRoutes = require("./routes/mosaicwall/displayMediaRoutes");
const eventduelGameRoutes = require("./routes/eventduel/gameRoutes");
const eventduelSessionRoutes = require("./routes/eventduel/gameSessionRoutes");
const eventduelQuestionRoutes = require("./routes/eventduel/questionRoutes");
const spinWheelRoutes = require("./routes/eventWheel/spinWheelRoutes");
const spinWheelParticipantRoutes = require("./routes/eventWheel/spinWheelParticipantRoutes");

const app = express();
app.use(morgan("dev"));

const allowedOrigins = [
  "http://localhost:3000",
  "https://eventpass-whitewall.vercel.app",
];

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like curl/postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS: " + origin));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
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
app.use("/api/translate", translateRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/global-config", globalConfigRoutes );
app.use("/api/businesses", businessRoutes );

// Quiznest Routes
app.use("/api/quiznest/games", gameRoutes);
app.use("/api/quiznest/players", playerRoutes);
app.use("/api/quiznest/questions", questionRoutes);

// Votecast Routes
app.use("/api/votecast/polls", pollRoutes);

// EventReg Routes
app.use("/api/eventreg/events", eventRegEventRoutes);
app.use("/api/eventreg/registrations", eventRegRegistrationRoutes);

// CheckIn Routes
app.use("/api/checkin/events", CheckInEventRoutes);
app.use("/api/checkin/registrations", CheckInRegistrationRoutes);

// StageQ Routes
app.use("/api/stageq/questions", stageqQuestionRoutes);
app.use("/api/stageq/visitors", stageqVisitorRoutes);

// MosaicWall Routes
app.use("/api/mosaicwall/wall-configs", mosaicWallWallConfigRoutes);
app.use("/api/mosaicwall/display-media", mosaicWallDisplayMediaRoutes);

// EventDuel (PvP) Routes
app.use("/api/eventduel/games", eventduelGameRoutes);
app.use("/api/eventduel/sessions", eventduelSessionRoutes);
app.use("/api/eventduel/questions", eventduelQuestionRoutes);

// EventWheel Routes
app.use("/api/eventwheel/wheels", spinWheelRoutes);
app.use("/api/eventwheel/participants", spinWheelParticipantRoutes);

// Health Check
app.get("/", (req, res) => {
  res.status(200).send("📡 EventPass Suite Server is running...");
});

// 404 handler
app.use((req, res, next) => {
  return response(res, 404, `Route not found: ${req.originalUrl}`);
});

// Error Handler
app.use(errorHandler);

module.exports = app;
