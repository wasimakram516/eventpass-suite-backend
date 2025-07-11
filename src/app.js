const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");
const morgan = require("morgan");
const errorHandler = require("./middlewares/errorHandler");
const seedAdmin = require("./seeder/adminSeeder");

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


const app = express();
app.use(morgan("dev"));

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000","http://192.168.100.7:3000"],
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

// Health Check
app.get("/", (req, res) => {
  res.status(200).send("📡 EventPass Suite Server is running...");
});

// Error Handler
app.use(errorHandler);

module.exports = app;
