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
  business: { model: Business, controller: businessController },

  // Events
  "event-eventreg": { model: Event, controller: eventRegEventController, condition: { eventType: "public" } },
  "event-checkin": { model: Event, controller: checkInEventController, condition: { eventType: "employee" } },

  // Registrations
  "registration-eventreg": {
  model: Registration,
  controller: {
    restore: eventRegRegistrationController.restoreRegistration,
    permanentDelete: eventRegRegistrationController.permanentDeleteRegistration,
    restoreAll: eventRegRegistrationController.restoreAllRegistrations,
    permanentDeleteAll: eventRegRegistrationController.permanentDeleteAllRegistrations
  },
  condition: { "eventId.eventType": "public" }
},

  "registration-checkin": { 
    model: Registration,
    controller: checkInRegistrationController,
    condition: { "eventId.eventType": "employee" }
  },

  // Other modules
  poll: { model: Poll, controller: pollController },
  spinwheel: { model: SpinWheel, controller: spinWheelController },
  spinwheelparticipant: { model: SpinWheelParticipant, controller: spinWheelParticipantController },
  displaymedia: { model: DisplayMedia, controller: displayMediaController },
  wallconfig: { model: WallConfig, controller: wallConfigController },
  globalconfig: { model: GlobalConfig, controller: globalConfigController },
  user: { model: User, controller: usersController },

  // QuizNest
  "game-quiznest": { model: Game, controller: qnGameController },
  "gamesession-quiznest": { model: GameSession, controller: qnGameController },
  qnquestion: { model: null, controller: qnQuestionController },
  qnplayer: { model: Player, controller: qnPlayerController },

  // EventDuel
  "game-eventduel": { model: Game, controller: pvpGameController },
  "gamesession-eventduel": { model: GameSession, controller: pvpGameSessionController },
  pvpquestion: { model: null, controller: pvpQuestionController },

  // StageQ
  question: { model: require("../models/EventQuestion"), controller: questionController },
  visitor: { model: Visitor, controller: visitorController },

  // SurveyGuru
  surveyform: { model: SurveyForm, controller: formController },
  surveyresponse: { model: SurveyResponse, controller: responseController },

  // Walkins
  walkin: { model: WalkIn, controller: checkInRegistrationController },
};

module.exports = moduleMapping;

