// Import Models
const User = require("../models/User");
const Business = require("../models/Business");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const Poll = require("../models/Poll");
const SpinWheel = require("../models/SpinWheel");
const SpinWheelParticipant = require("../models/SpinWheelParticipant");
const Game = require("../models/Game");
const GameSession = require("../models/GameSession");
const Player = require("../models/Player");
const SurveyForm = require("../models/SurveyForm");
const SurveyResponse = require("../models/SurveyResponse");
const Visitor = require("../models/Visitor");
const WalkIn = require("../models/WalkIn");
const DisplayMedia = require("../models/DisplayMedia");
const WallConfig = require("../models/WallConfig");
const GlobalConfig = require("../models/GlobalConfig");

// Import Controllers
const businessController = require("../controllers/businessController");
const checkInEventController = require("../controllers/CheckIn/eventController");
const checkInRegistrationController = require("../controllers/CheckIn/registrationController");
const eventRegEventController = require("../controllers/EventReg/eventController");
const eventRegRegistrationController = require("../controllers/EventReg/registrationController");
const pollController = require("../controllers/votecast/pollController");
const spinWheelController = require("../controllers/EventWheel/spinWheelController");
const spinWheelParticipantController = require("../controllers/EventWheel/spinWheelParticipantController");
const displayMediaController = require("../controllers/mosaicwall/displayMediaController");
const wallConfigController = require("../controllers/mosaicwall/wallConfigController");
const globalConfigController = require("../controllers/globalConfigController");
const usersController = require("../controllers/usersController");
const qnGameController = require("../controllers/quiznest/QNgameController");
const qnPlayerController = require("../controllers/quiznest/QNplayerController");
const qnQuestionController = require("../controllers/quiznest/QNquestionController");
const questionController = require("../controllers/stageq/questionController");
const visitorController = require("../controllers/stageq/visitorController");
const formController = require("../controllers/SurveyGuru/formController");
const responseController = require("../controllers/SurveyGuru/responseController");
const pvpGameController = require("../controllers/eventduel/pvpGameController");
const pvpGameSessionController = require("../controllers/eventduel/pvpGameSessionController");
const pvpQuestionController = require("../controllers/eventduel/pvpQuestionController");

// -------------------
// SINGLE SOURCE OF TRUTH
// -------------------

const moduleMapping = {
  business: {
    model: Business,
    controller: {
      restore: businessController.restoreBusiness,
      permanentDelete: businessController.permanentDeleteBusiness,
      restoreAll: businessController.restoreAllBusinesses,
      permanentDeleteAll: businessController.permanentDeleteAllBusinesses,
    },
  },

  // Events
  "event-eventreg": {
    model: Event,
    controller: {
      restore: eventRegEventController.restoreEvent,
      permanentDelete: eventRegEventController.permanentDeleteEvent,
      restoreAll: eventRegEventController.restoreAllEvents,
      permanentDeleteAll: eventRegEventController.permanentDeleteAllEvents,
    },
    condition: { eventType: "public" },
  },
  "event-checkin": {
    model: Event,
    controller: {
      restore: checkInEventController.restoreEvent,
      permanentDelete: checkInEventController.permanentDeleteEvent,
      restoreAll: checkInEventController.restoreAllEvents,
      permanentDeleteAll: checkInEventController.permanentDeleteAllEvents,
    },
    condition: { eventType: "employee" },
  },

  // Registrations
  "registration-eventreg": {
    model: Registration,
    controller: {
      restore: eventRegRegistrationController.restoreRegistration,
      permanentDelete:
        eventRegRegistrationController.permanentDeleteRegistration,
      restoreAll: eventRegRegistrationController.restoreAllRegistrations,
      permanentDeleteAll:
        eventRegRegistrationController.permanentDeleteAllRegistrations,
    },
    condition: { "eventId.eventType": "public" },
  },

  "registration-checkin": {
    model: Registration,
    controller: {
      restore: checkInRegistrationController.restoreRegistration,
      permanentDelete:
        checkInRegistrationController.permanentDeleteRegistration,
      restoreAll: checkInRegistrationController.restoreAllRegistrations,
      permanentDeleteAll:
        checkInRegistrationController.permanentDeleteAllRegistrations,
    },
    condition: { "eventId.eventType": "employee" },
  },

  // Other modules
  poll: {
    model: Poll,
    controller: {
      restore: pollController.restorePoll,
      permanentDelete: pollController.permanentDeletePoll,
      restoreAll: pollController.restoreAllPolls,
      permanentDeleteAll: pollController.permanentDeleteAllPolls,
    },
  },
  spinwheel: {
    model: SpinWheel,
    controller: {
      restore: spinWheelController.restoreSpinWheel,
      permanentDelete: spinWheelController.permanentDeleteSpinWheel,
      restoreAll: spinWheelController.restoreAllSpinWheels,
      permanentDeleteAll: spinWheelController.permanentDeleteAllSpinWheels,
    },
  },
  spinwheelparticipant: {
    model: SpinWheelParticipant,
    controller: {
      restore: spinWheelParticipantController.restoreParticipant,
      permanentDelete:
        spinWheelParticipantController.permanentDeleteParticipant,
      restoreAll: spinWheelParticipantController.restoreAllParticipants,
      permanentDeleteAll:
        spinWheelParticipantController.permanentDeleteAllParticipants,
    },
  },
  displaymedia: {
    model: DisplayMedia,
    controller: {
      restore: displayMediaController.restoreMedia,
      permanentDelete: displayMediaController.permanentDeleteMedia,
      restoreAll: displayMediaController.restoreAllMedia,
      permanentDeleteAll: displayMediaController.permanentDeleteAllMedia,
    },
  },
  wallconfig: {
    model: WallConfig,
    controller: {
      restore: wallConfigController.restoreWall,
      permanentDelete: wallConfigController.permanentDeleteWall,
      restoreAll: wallConfigController.restoreAllWalls,
      permanentDeleteAll: wallConfigController.permanentDeleteAllWalls,
    },
  },
  globalconfig: {
    model: GlobalConfig,
    controller: {
      restore: globalConfigController.restoreConfig,
      permanentDelete: globalConfigController.permanentDeleteConfig,
    },
  },
  user: {
    model: User,
    controller: {
      restore: usersController.restoreUser,
      permanentDelete: usersController.permanentDeleteUser,
      restoreAll: usersController.restoreAllUsers,
      permanentDeleteAll: usersController.permanentDeleteAllUsers,
    },
  },

  // QuizNest
  "game-quiznest": {
    model: Game,
    controller: {
      restore: qnGameController.restoreGame,
      permanentDelete: qnGameController.permanentDeleteGame,
      restoreAll: qnGameController.restoreAllGames,
      permanentDeleteAll: qnGameController.permanentDeleteAllGames,
    },
    condition: { mode: "solo" },
  },
  qnquestion: {
    model: Game,
    controller: {
      restore: qnQuestionController.restoreQuestion,
      permanentDelete: qnQuestionController.permanentDeleteQuestion,
      restoreAll: qnQuestionController.restoreAllQuestions,
      permanentDeleteAll: qnQuestionController.permanentDeleteAllQuestions,
    },
    condition: { mode: "solo" },
    customAggregation: true, // Flag to indicate we need custom aggregation for embedded questions
  },

  // EventDuel
  "game-eventduel": {
    model: Game,
    controller: {
      restore: pvpGameController.restoreGame,
      permanentDelete: pvpGameController.permanentDeleteGame,
      restoreAll: pvpGameController.restoreAllGames,
      permanentDeleteAll: pvpGameController.permanentDeleteAllGames,
    },
    condition: { mode: "pvp" },
  },
  "gamesession-eventduel": {
    model: GameSession,
    controller: {
      restore: pvpGameSessionController.restoreGameSession,
      permanentDelete: pvpGameSessionController.permanentDeleteGameSession,
      restoreAll: pvpGameSessionController.restoreAllGameSessions,
      permanentDeleteAll: pvpGameSessionController.permanentDeleteAllGameSessions,
    },
    condition: { "gameId.mode": "pvp" }, 
  },
  pvpquestion: {
    model: Game,
    controller: {
      restore: pvpQuestionController.restoreQuestion,
      permanentDelete: pvpQuestionController.permanentDeleteQuestion,
      restoreAll: pvpQuestionController.restoreAllQuestions,
      permanentDeleteAll: pvpQuestionController.permanentDeleteAllQuestions,
    },
    condition: { mode: "pvp" },
    customAggregation: true,
  },

  // StageQ
  question: {
    model: require("../models/EventQuestion"),
    controller: {
      restore: questionController.restoreQuestion,
      permanentDelete: questionController.permanentDeleteQuestion,
      restoreAll: questionController.restoreAllQuestions,
      permanentDeleteAll: questionController.permanentDeleteAllQuestions,
    },
  },
  visitor: { model: Visitor, controller: visitorController },

  // SurveyGuru
  surveyform: {
    model: SurveyForm,
    controller: {
      restore: formController.restoreForm,
      permanentDelete: formController.permanentDeleteForm,
      restoreAll: formController.restoreAllForms,
      permanentDeleteAll: formController.permanentDeleteAllForms,
    },
  },
  surveyresponse: {
    model: SurveyResponse,
    controller: {
      restore: responseController.restoreResponse,
      permanentDelete: responseController.permanentDeleteResponse,
      restoreAll: responseController.restoreAllResponses,
      permanentDeleteAll: responseController.permanentDeleteAllResponses,
    },
  },

  // Walkins
  walkin: { model: WalkIn, controller: checkInRegistrationController },
};

module.exports = moduleMapping;

