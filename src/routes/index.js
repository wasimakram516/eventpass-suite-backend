const express = require("express");

// Import all route modules
const moduleRoutes = require("./moduleRoutes");
const translateRoutes = require("./translateRoutes");
const trashRoutes = require("./trashRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const fileResourceRoutes = require("./fileResourceRoutes");
const deleteMediaRoutes = require("./deleteMediaRoutes");
const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const globalConfigRoutes = require("./globalConfigRoutes");
const businessRoutes = require("./businessRoutes");

// QuizNest
const quizGameRoutes = require("./quiznest/gameRoutes");
const quizPlayerRoutes = require("./quiznest/playerRoutes");
const quizQuestionRoutes = require("./quiznest/questionRoutes");

// EventDuel
const eventduelGameRoutes = require("./eventduel/gameRoutes");
const eventduelSessionRoutes = require("./eventduel/gameSessionRoutes");
const eventduelQuestionRoutes = require("./eventduel/questionRoutes");

// TapMatch
const tapmatchGameRoutes = require("./tapmatch/gameRoutes");
const tapmatchPlayerRoutes = require("./tapmatch/playerRoutes");

// Votecast
const pollRoutes = require("./votecast/pollRoutes");

// EventReg
const eventRegEventRoutes = require("./EventReg/eventRoutes");
const eventRegRegistrationRoutes = require("./EventReg/registrationRoutes");
const insightsRoutes = require("./EventReg/insightsRoutes");

// SurveyGuru
const surveyRecipientRoutes = require("./surveyguru/surveyRecipientRoutes");
const surveyFormRoutes = require("./surveyguru/surveyFormRoutes");
const surveyResponseRoutes = require("./surveyguru/surveyResponseRoutes");
const surveyGuruInsightsRoutes = require("./surveyguru/insightsRoutes");

// CheckIn
const checkInEventRoutes = require("./CheckIn/eventRoutes");
const checkInRegistrationRoutes = require("./CheckIn/registrationRoutes");

// StageQ
const stageqQuestionRoutes = require("./stageq/questionRoutes");
const stageqVisitorRoutes = require("./stageq/visitorRoutes");

// MosaicWall
const mosaicWallWallConfigRoutes = require("./mosaicwall/wallConfigRoutes");
const mosaicWallDisplayMediaRoutes = require("./mosaicwall/displayMediaRoutes");

// EventWheel
const spinWheelRoutes = require("./eventWheel/spinWheelRoutes");
const spinWheelParticipantRoutes = require("./eventWheel/spinWheelParticipantRoutes");

// Notifications
const whatsappLogs = require("./notifications/whatsappLogRoutes");
const whatsappInboxRoutes = require("./notifications/whatsappInboxRoutes");

// Webhooks
const twilioWhatsAppStatusWebhookRoutes = require("./webhooks/twilioWhatsAppRoutes");

const router = express.Router();

// ------------------ Base CMS Routes ------------------
router.use("/modules", moduleRoutes);
router.use("/translate", translateRoutes);
router.use("/trash", trashRoutes);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/global-config", globalConfigRoutes);
router.use("/businesses", businessRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/files", fileResourceRoutes);
router.use("/media", deleteMediaRoutes);
router.use("/notifications/whatsapp-logs", whatsappLogs);
router.use("/notifications/whatsapp-inbox", whatsappInboxRoutes);

router.use("/webhooks/twilio/whatsapp", twilioWhatsAppStatusWebhookRoutes);

// ------------------ QuizNest ------------------
router.use("/quiznest/games", quizGameRoutes);
router.use("/quiznest/players", quizPlayerRoutes);
router.use("/quiznest/questions", quizQuestionRoutes);

// ------------------ EventDuel ------------------
router.use("/eventduel/games", eventduelGameRoutes);
router.use("/eventduel/sessions", eventduelSessionRoutes);
router.use("/eventduel/questions", eventduelQuestionRoutes);

// ------------------ TapMatch ------------------
router.use("/tapmatch/games", tapmatchGameRoutes);
router.use("/tapmatch/player", tapmatchPlayerRoutes);

// ------------------ Votecast ------------------
router.use("/votecast/polls", pollRoutes);

// ------------------ EventReg ------------------
router.use("/eventreg/events", eventRegEventRoutes);
router.use("/eventreg/registrations", eventRegRegistrationRoutes);
router.use("/eventreg/insights", insightsRoutes);

// ------------------ SurveyGuru ------------------
router.use("/surveyguru", surveyRecipientRoutes);
router.use("/surveyguru", surveyFormRoutes);
router.use("/surveyguru", surveyResponseRoutes);
router.use("/surveyguru", surveyGuruInsightsRoutes);

// ------------------ CheckIn ------------------
router.use("/checkin/events", checkInEventRoutes);
router.use("/checkin/registrations", checkInRegistrationRoutes);

// ------------------ StageQ ------------------
router.use("/stageq/questions", stageqQuestionRoutes);
router.use("/stageq/visitors", stageqVisitorRoutes);

// ------------------ MosaicWall ------------------
router.use("/mosaicwall/wall-configs", mosaicWallWallConfigRoutes);
router.use("/mosaicwall/display-media", mosaicWallDisplayMediaRoutes);

// ------------------ EventWheel ------------------
router.use("/eventwheel/wheels", spinWheelRoutes);
router.use("/eventwheel/participants", spinWheelParticipantRoutes);

module.exports = router;