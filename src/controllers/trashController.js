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
 question: EventQuestion,
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
    restore: qnGameController.restoreGame,
    permanentDelete: qnGameController.permanentDeleteGame,
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
// Module mapping for calculating counts per business module
const moduleMapping = {
  quiznest: [
    { model: 'game', condition: { mode: 'solo' } },
    { model: 'gamesession', populateField: 'gameId', populateCondition: { mode: 'solo' } }
  ],
  eventduel: [
    { model: 'game', condition: { mode: 'pvp' } },
    { model: 'gamesession', populateField: 'gameId', populateCondition: { mode: 'pvp' } }
  ],
  eventreg: [
    { model: 'event', condition: { eventType: 'public' } },
    { model: 'registration', populateField: 'eventId', populateCondition: { eventType: 'public' } },
    { model: 'walkin' }
  ],
  checkin: [
    { model: 'event', condition: { eventType: 'employee' } },
    { model: 'registration', populateField: 'eventId', populateCondition: { eventType: 'employee' } }
  ],
  surveyguru: [
    { model: 'surveyform' },
    { model: 'surveyresponse' }
  ],
  votecast: [
    { model: 'poll' }
  ],
  stageq: [
    { model: 'question' },
    { model: 'visitor' }
  ],
  mosaicwall: [
    { model: 'displaymedia' },
    { model: 'wallconfig' }
  ],
  eventwheel: [
    { model: 'spinwheel' },
    { model: 'spinwheelparticipant' }
  ],
  users: [
    { model: 'user' }
  ],
  businesses: [
    { model: 'business' }
  ]
};

// Get module-wise deletion counts
exports.getModuleCounts = asyncHandler(async (req, res) => {
  const moduleCounts = {};

  const moduleCountPromises = Object.entries(moduleMapping).map(async ([moduleName, modelConfigs]) => {
    let totalCount = 0;

    const modelPromises = modelConfigs.map(async (config) => {
      const Model = models[config.model];
      if (!Model) return 0;

      if (config.condition) {
        return await Model.countDocumentsDeleted(config.condition);
      } else if (config.populateField && config.populateCondition) {
        const items = await Model.findDeleted({}).populate(config.populateField).lean();
        return items.filter(item => {
          const populatedDoc = item[config.populateField];
          if (!populatedDoc) return false;
          return Object.entries(config.populateCondition).every(([key, value]) =>
            populatedDoc[key] === value
          );
        }).length;
      } else {
        return await Model.countDocumentsDeleted({});
      }
    });

    const counts = await Promise.all(modelPromises);
    totalCount = counts.reduce((sum, count) => sum + count, 0);

    return { moduleName, count: totalCount };
  });

  const results = await Promise.all(moduleCountPromises);
  results.forEach(({ moduleName, count }) => {
    moduleCounts[moduleName] = count;
  });

  return response(res, 200, "Fetched module deletion counts", moduleCounts);
});

//function to determine module-specific model key based on conditions
const getModuleSpecificKey = async (modelName, item) => {
  switch (modelName) {
    case 'registration':
      if (item.eventId) {
        const populatedItem = await models.registration.findDeleted({ _id: item._id }).populate('eventId');
        if (populatedItem && populatedItem.length > 0 && populatedItem[0].eventId) {
          return populatedItem[0].eventId.eventType === 'public' ? 'registration-eventreg' : 'registration-checkin';
        }
      }
      return 'registration';
    case 'event':
      return item.eventType === 'public' ? 'event-eventreg' : 'event-checkin';
    case 'game':
      return item.mode === 'solo' ? 'game-quiznest' : 'game-eventduel';
    case 'gamesession':
      if (item.gameId) {
        const populatedItem = await models.gamesession.findDeleted({ _id: item._id }).populate('gameId');
        if (populatedItem && populatedItem.length > 0 && populatedItem[0].gameId) {
          return populatedItem[0].gameId.mode === 'solo' ? 'gamesession-quiznest' : 'gamesession-eventduel';
        }
      }
      return 'gamesession';
    default:
      return modelName;
  }
};

// List trash (generic, uses models directly)
exports.getTrash = asyncHandler(async (req, res) => {
  const { model, deletedBy, startDate, endDate, page = 1, limit = 20 } = req.query;
  // function to extract base model and conditions from combined module keys
  const parseModuleFilter = (moduleKey) => {
    if (!moduleKey || moduleKey === '__ALL__') return { baseModel: null, conditions: {} };

    if (moduleKey.includes('-')) {
      const [baseModel, subModule] = moduleKey.split('-');
      const conditions = {};

      switch (moduleKey) {
        case 'game-quiznest':
          conditions.mode = 'solo';
          break;
        case 'game-eventduel':
          conditions.mode = 'pvp';
          break;
        case 'event-eventreg':
          conditions.eventType = 'public';
          break;
        case 'event-checkin':
          conditions.eventType = 'employee';
          break;
      }

      return { baseModel, conditions };
    }

    return { baseModel: moduleKey, conditions: {} };
  };
  const getConditionForModuleKey = (moduleKey, originalKey) => {
    const conditions = {};
    switch (moduleKey) {
      case 'event-eventreg':
        conditions.eventType = 'public';
        break;
      case 'event-checkin':
        conditions.eventType = 'employee';
        break;
      case 'game-quiznest':
        conditions.mode = 'solo';
        break;
      case 'game-eventduel':
        conditions.mode = 'pvp';
        break;
    }
    return conditions;
  };
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
    const { baseModel, conditions } = parseModuleFilter(model);
    const M = models[baseModel?.toLowerCase()];
    if (!M) return response(res, 400, "Invalid model");

    const finalQuery = { ...query, ...conditions };

    let items, total;
    if (model === 'registration-eventreg' || model === 'registration-checkin') {
      const allItems = await M.findDeleted(query).populate('eventId').sort({ deletedAt: -1 });
      const filteredItems = allItems.filter(item => {
        if (!item.eventId) return false;
        return model === 'registration-eventreg' ?
          item.eventId.eventType === 'public' :
          item.eventId.eventType === 'employee';
      });
      items = filteredItems.slice(skip, skip + parseInt(limit));
      total = filteredItems.length;
    } else if (model === 'gamesession-quiznest' || model === 'gamesession-eventduel') {
      const allItems = await M.findDeleted(query).populate('gameId').sort({ deletedAt: -1 });
      const filteredItems = allItems.filter(item => {
        if (!item.gameId) return false;
        return model === 'gamesession-quiznest' ?
          item.gameId.mode === 'solo' :
          item.gameId.mode === 'pvp';
      });
      items = filteredItems.slice(skip, skip + parseInt(limit));
      total = filteredItems.length;
    } else {
      // Standard filtering with direct conditions
      [items, total] = await Promise.all([
        M.findDeleted(finalQuery)
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ deletedAt: -1 })
          .lean(),
        M.countDocumentsDeleted(finalQuery)
      ]);
    }

    results[model] = { items, total };
  } else {
    // Using Promise.all for parallel execution with module-specific grouping
    const modelQueries = Object.entries(models).map(async ([key, M]) => {
      const [items, total] = await Promise.all([
        M.findDeleted(query).limit(5).sort({ deletedAt: -1 }).populate(
          key === 'registration' ? 'eventId' : key === 'gamesession' ? 'gameId' : ''
        ),
        M.countDocumentsDeleted(query)
      ]);

      if (total > 0) {
        // Group items by module-specific keys
        const groupedItems = {};
        for (const item of items) {
          const moduleKey = await getModuleSpecificKey(key, item);
          if (!groupedItems[moduleKey]) {
            groupedItems[moduleKey] = { items: [], total: 0 };
          }
          groupedItems[moduleKey].items.push(item);
        }

        // Calculate totals for each group
        for (const moduleKey of Object.keys(groupedItems)) {
          const condition = getConditionForModuleKey(moduleKey, key);
          groupedItems[moduleKey].total = await M.countDocumentsDeleted({ ...query, ...condition });
        }

        return groupedItems;
      }
      return null;
    });

    const modelResults = await Promise.all(modelQueries);
    modelResults.forEach(groupedResult => {
      if (groupedResult) {
        Object.assign(results, groupedResult);
      }
    });
  }
  // Calculate module counts
  let moduleCounts = null;
  if (req.query.includeCounts === 'true') {
    const moduleCountPromises = Object.entries(moduleMapping).map(async ([moduleName, modelConfigs]) => {
      let totalCount = 0;
      const modelPromises = modelConfigs.map(async (config) => {
        const Model = models[config.model];
        if (!Model) return 0;

        if (config.condition) {
          return await Model.countDocumentsDeleted(config.condition);
        } else if (config.populateField && config.populateCondition) {
          const items = await Model.findDeleted({}).populate(config.populateField).lean();
          return items.filter(item => {
            const populatedDoc = item[config.populateField];
            if (!populatedDoc) return false;
            return Object.entries(config.populateCondition).every(([key, value]) =>
              populatedDoc[key] === value
            );
          }).length;
        } else {
          return await Model.countDocumentsDeleted({});
        }
      });
      const counts = await Promise.all(modelPromises);
      totalCount = counts.reduce((sum, count) => sum + count, 0);
      return { moduleName, count: totalCount };
    });

    const moduleResults = await Promise.all(moduleCountPromises);
    moduleCounts = {};
    moduleResults.forEach(({ moduleName, count }) => {
      moduleCounts[moduleName] = count;
    });
  } 

  return response(res, 200, "Fetched trash items", { items: results, moduleCounts });
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