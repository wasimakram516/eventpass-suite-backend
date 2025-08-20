const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");

// Import models
const User = require("../models/User");
const Business = require("../models/Business");
const Event = require("../models/Event");
const EventQuestion = require("../models/EventQuestion");
const Poll = require("../models/Poll");
const SpinWheel = require("../models/SpinWheel");
const SpinWheelParticipant = require("../models/SpinWheelParticipant");
const Game = require("../models/Game");
const GameSession = require("../models/GameSession");
const Player = require("../models/Player");
const Registration = require("../models/Registration");
const SurveyForm = require("../models/SurveyForm");
const SurveyResponse = require("../models/SurveyResponse");
const Visitor = require("../models/Visitor");
const WalkIn = require("../models/WalkIn");
const DisplayMedia = require("../models/DisplayMedia");
const WallConfig = require("../models/WallConfig");
const GlobalConfig = require("../models/GlobalConfig");

// Import controllers (only those with restore + permanent delete implemented)
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

// Map of models for querying trash
const models = {
  user: User,
  business: Business,
  event: Event,
  eventquestion: EventQuestion,
  poll: Poll,
  spinwheel: SpinWheel,
  spinwheelparticipant: SpinWheelParticipant,
  game: Game,
  gamesession: GameSession,
  player: Player,
  registration: Registration,
  surveyform: SurveyForm,
  surveyresponse: SurveyResponse,
  visitor: Visitor,
  walkin: WalkIn,
  displaymedia: DisplayMedia,
  wallconfig: WallConfig,
  globalconfig: GlobalConfig,
};

// Mapping module → controller methods
const controllerMap = {
  business: {
    restore: businessController.restoreBusiness,
    permanentDelete: businessController.permanentDeleteBusiness,
  },
  checkinevent: {
    restore: checkInEventController.restoreEvent,
    permanentDelete: checkInEventController.permanentDeleteEvent,
  },
  checkinregistration: {
    restore: checkInRegistrationController.restoreRegistration,
    permanentDelete: checkInRegistrationController.permanentDeleteRegistration,
  },
  eventregevent: {
    restore: eventRegEventController.restoreEvent,
    permanentDelete: eventRegEventController.permanentDeleteEvent,
  },
  eventregregistration: {
    restore: eventRegRegistrationController.restoreRegistration,
    permanentDelete: eventRegRegistrationController.permanentDeleteRegistration,
  },
  poll: {
    restore: pollController.restorePoll,
    permanentDelete: pollController.permanentDeletePoll,
  },
  spinwheel: {
    restore: spinWheelController.restoreSpinWheel,
    permanentDelete: spinWheelController.permanentDeleteSpinWheel,
  },
  spinwheelparticipant: {
    restore: spinWheelParticipantController.restoreParticipant,
    permanentDelete: spinWheelParticipantController.permanentDeleteParticipant,
  },
  displaymedia: {
    restore: displayMediaController.restoreDisplayMedia,
    permanentDelete: displayMediaController.permanentDeleteDisplayMedia,
  },
  wallconfig: {
    restore: wallConfigController.restoreWallConfig,
    permanentDelete: wallConfigController.permanentDeleteWallConfig,
  },
  globalconfig: {
    restore: globalConfigController.restoreConfig,
    permanentDelete: globalConfigController.permanentDeleteConfig,
  },
  user: {
    restore: usersController.restoreUser,
    permanentDelete: usersController.permanentDeleteUser,
  },
  qngame: {
    restore: qnGameController.restoreQNGame,
    permanentDelete: qnGameController.permanentDeleteQNGame,
  },
  qnplayer: {
    restore: qnPlayerController.restoreQNPlayer,
    permanentDelete: qnPlayerController.permanentDeleteQNPlayer,
  },
  qnquestion: {
    restore: qnQuestionController.restoreQNQuestion,
    permanentDelete: qnQuestionController.permanentDeleteQNQuestion,
  },
  question: {
    restore: questionController.restoreQuestion,
    permanentDelete: questionController.permanentDeleteQuestion,
  },
  visitor: {
    restore: visitorController.restoreVisitor,
    permanentDelete: visitorController.permanentDeleteVisitor,
  },
  surveyform: {
    restore: formController.restoreForm,
    permanentDelete: formController.permanentDeleteForm,
  },
  surveyresponse: {
    restore: responseController.restoreResponse,
    permanentDelete: responseController.permanentDeleteResponse,
  },
  pvpgame: {
    restore: pvpGameController.restoreGame,
    permanentDelete: pvpGameController.permanentDeleteGame,
  },
  pvpgamesession: {
    restore: pvpGameSessionController.restoreSession,
    permanentDelete: pvpGameSessionController.permanentDeleteSession,
  },
  pvpquestion: {
    restore: pvpQuestionController.restoreQuestion,
    permanentDelete: pvpQuestionController.permanentDeleteQuestion,
  },
};

// List trash (generic, uses models directly)
exports.getTrash = asyncHandler(async (req, res) => {
  const { model, deletedBy, startDate, endDate, page = 1, limit = 20 } = req.query;
  const user = req.user;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const query = {};

  if (deletedBy) query.deletedBy = deletedBy;
  if (startDate || endDate) {
    query.deletedAt = {};
    if (startDate) query.deletedAt.$gte = new Date(startDate);
    if (endDate) query.deletedAt.$lte = new Date(endDate);
  }

  // Business users see only their own records
  if (user.role === "business") {
    query.$or = [
      { business: user.business },       // for models with "business"
      { businessId: user.business },     // for models with "businessId"
    ];
  }

  let results = {};

  if (model) {
    const M = models[model.toLowerCase()];
    if (!M) return response(res, 400, "Invalid model");

    const items = await M.findDeleted(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ deletedAt: -1 });

    const total = await M.countDocumentsDeleted(query);

    results[model] = { items, total };
  } else {
    // All models
    for (const [key, M] of Object.entries(models)) {
      const items = await M.findDeleted(query).limit(5).sort({ deletedAt: -1 });
      const total = await M.countDocumentsDeleted(query);
      if (total > 0) results[key] = { items, total };
    }
  }

  return response(res, 200, "Fetched trash items", results);
});

// Restore
exports.restoreItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const ctrl = controllerMap[module.toLowerCase()];
  if (!ctrl?.restore) return response(res, 400, "Restore not implemented for this module");
  return ctrl.restore(req, res, next);
});

// Permanent delete
exports.permanentDeleteItem = asyncHandler(async (req, res, next) => {
  const { module } = req.params;
  const ctrl = controllerMap[module.toLowerCase()];
  if (!ctrl?.permanentDelete) return response(res, 400, "Permanent delete not implemented for this module");
  return ctrl.permanentDelete(req, res, next);
});
