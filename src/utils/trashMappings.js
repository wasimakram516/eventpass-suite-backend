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
const SurveyForm = require("../models/SurveyForm");
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
const qnQuestionController = require("../controllers/quiznest/QNquestionController");
const questionController = require("../controllers/stageq/questionController");
const formController = require("../controllers/SurveyGuru/formController");
const pvpGameController = require("../controllers/eventduel/pvpGameController");
const pvpGameSessionController = require("../controllers/eventduel/pvpGameSessionController");
const pvpQuestionController = require("../controllers/eventduel/pvpQuestionController");
const tmGameController = require("../controllers/tapmatch/TMgameController");

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
    condition: { "event.eventType": "public" },
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
    condition: { "event.eventType": "employee" },
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

  // -------------------
  // QUIZNEST (solo + quiz)
  // -------------------
  "game-quiznest": {
    model: Game,
    controller: {
      restore: qnGameController.restoreGame,
      permanentDelete: qnGameController.permanentDeleteGame,
      restoreAll: qnGameController.restoreAllGames,
      permanentDeleteAll: qnGameController.permanentDeleteAllGames,
    },
    condition: { mode: "solo", type: "quiz" },
  },

  qnquestion: {
    model: Game,
    controller: {
      restore: qnQuestionController.restoreQuestion,
      permanentDelete: qnQuestionController.permanentDeleteQuestion,
      restoreAll: qnQuestionController.restoreAllQuestions,
      permanentDeleteAll: qnQuestionController.permanentDeleteAllQuestions,
    },
    condition: { mode: "solo", type: "quiz" },
    customAggregation: true,
  },

  // -------------------
  // TAPMATCH (solo + memory)
  // -------------------
  "game-tapmatch": {
  model: Game,
  controller: {
    restore: tmGameController.restoreGame,
    permanentDelete: tmGameController.permanentDeleteGame,
    restoreAll: tmGameController.restoreAllGames,
    permanentDeleteAll: tmGameController.permanentDeleteAllGames,
  },
  condition: { mode: "solo", type: "memory" }
},

  // -------------------
  // EVENTDUEL (pvp + quiz)
  // -------------------
  "game-eventduel": {
    model: Game,
    controller: {
      restore: pvpGameController.restoreGame,
      permanentDelete: pvpGameController.permanentDeleteGame,
      restoreAll: pvpGameController.restoreAllGames,
      permanentDeleteAll: pvpGameController.permanentDeleteAllGames,
    },
    condition: { mode: "pvp", type: "quiz" },
  },

  "gamesession-eventduel": {
    model: GameSession,
    controller: {
      restore: pvpGameSessionController.restoreGameSession,
      permanentDelete: pvpGameSessionController.permanentDeleteGameSession,
      restoreAll: pvpGameSessionController.restoreAllGameSessions,
      permanentDeleteAll:
        pvpGameSessionController.permanentDeleteAllGameSessions,
    },
    condition: { "gameId.mode": "pvp", "gameId.type": "quiz" },
  },

  pvpquestion: {
    model: Game,
    controller: {
      restore: pvpQuestionController.restoreQuestion,
      permanentDelete: pvpQuestionController.permanentDeleteQuestion,
      restoreAll: pvpQuestionController.restoreAllQuestions,
      permanentDeleteAll: pvpQuestionController.permanentDeleteAllQuestions,
    },
    condition: { mode: "pvp", type: "quiz" },
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

  // Walkins
  walkin: { model: WalkIn, controller: checkInRegistrationController },
};

module.exports = moduleMapping;
