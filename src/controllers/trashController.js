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
  pvpquestion: null,
  qnquestion: null,
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
    restore: qnQuestionController.restoreQuestion,
    permanentDelete: qnQuestionController.permanentDeleteQuestion,
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
    restore: pvpGameSessionController.restoreAllGameSessions,
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
    { model: 'gamesession', populateField: 'gameId', populateCondition: { mode: 'solo' } },
    { model: 'qnquestion' }
  ],
  eventduel: [
    { model: 'game', condition: { mode: 'pvp' } },
    { model: 'gamesession', populateField: 'gameId', populateCondition: { mode: 'pvp' } },
    { model: 'pvpquestion' }
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
const getDeletedQuestionsFromGames = async (query, mode = null) => {
  const gameQuery = {
    "questions.isDeleted": true,
    ...query
  };

  if (mode) {
    gameQuery.mode = mode;
  }

  const { deletedBy, ...gameOnlyQuery } = gameQuery;
  const games = await Game.find(gameOnlyQuery).lean();

  const deletedQuestions = [];
  games.forEach(game => {
    game.questions.forEach(question => {
      if (question.isDeleted) {
        // Apply deletedBy filter at question level if specified
        if (deletedBy && question.deletedBy && question.deletedBy.toString() !== deletedBy) {
          return;
        }

        deletedQuestions.push({
          ...question,
          _id: question._id,
          gameId: game._id,
          gameTitle: game.title,
          gameMode: game.mode
        });
      }
    });
  });

  return deletedQuestions;
};
// Get module-wise deletion counts
exports.getModuleCounts = asyncHandler(async (req, res) => {
  const moduleCounts = {};

  const moduleCountPromises = Object.entries(moduleMapping).map(async ([moduleName, modelConfigs]) => {
    let totalCount = 0;

    const modelPromises = modelConfigs.map(async (config) => {
      const Model = models[config.model];
      if (config.model === 'pvpquestion') {
        const deletedQuestions = await getDeletedQuestionsFromGames({}, 'pvp');
        return deletedQuestions.length;
      }
      if (config.model === 'qnquestion') {
        const deletedQuestions = await getDeletedQuestionsFromGames({}, 'solo');
        return deletedQuestions.length;
      }

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
    // handling for question modules that don't have direct models
    if (model === 'qnquestion') {
      const deletedQuestions = await getDeletedQuestionsFromGames(query, 'solo');
      const paginatedQuestions = deletedQuestions.slice(skip, skip + parseInt(limit));
      results[model] = { items: paginatedQuestions, total: deletedQuestions.length };
      return response(res, 200, "Fetched trash items", { items: results });
    }
    if (model === 'pvpquestion') {
      const deletedQuestions = await getDeletedQuestionsFromGames(query, 'pvp');
      const paginatedQuestions = deletedQuestions.slice(skip, skip + parseInt(limit));
      results[model] = { items: paginatedQuestions, total: deletedQuestions.length };
      return response(res, 200, "Fetched trash items", { items: results });
    }

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
      if (key === 'pvpquestion') {
        const deletedQuestions = await getDeletedQuestionsFromGames(query, 'pvp');
        if (deletedQuestions.length > 0) {
          return {
            pvpquestion: {
              items: deletedQuestions.slice(0, 5),
              total: deletedQuestions.length
            }
          };
        }
        return null;
      }
      if (key === 'qnquestion') {
        const deletedQuestions = await getDeletedQuestionsFromGames(query, 'solo');
        if (deletedQuestions.length > 0) {
          return {
            qnquestion: {
              items: deletedQuestions.slice(0, 5),
              total: deletedQuestions.length
            }
          };
        }
        return null;
      }
      if (key === 'player') {
        const allDeletedPlayers = await M.findDeleted(query).populate('_id');
        const deletedSessions = await GameSession.findDeleted({}).populate('gameId');
        const sessionPlayerIds = new Set();

        deletedSessions.forEach(session => {
          session.players.forEach(p => sessionPlayerIds.add(p.playerId.toString()));
        });

        const independentPlayers = allDeletedPlayers.filter(player =>
          !sessionPlayerIds.has(player._id.toString())
        );

        if (independentPlayers.length === 0) return null;

        return {
          player: {
            items: independentPlayers.slice(0, 5),
            total: independentPlayers.length
          }
        };
      }

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

        // handling for embedded questions in games
        if (config.model === 'pvpquestion') {
          const deletedQuestions = await getDeletedQuestionsFromGames({}, 'pvp');
          return deletedQuestions.length;
        }
        if (config.model === 'qnquestion') {
          const deletedQuestions = await getDeletedQuestionsFromGames({}, 'solo');
          return deletedQuestions.length;
        }

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

// Restore all items of a module 
exports.restoreAllItems = asyncHandler(async (req, res) => {
  const { module } = req.params;
  const { deletedBy, startDate, endDate } = req.query;
  const user = req.user;

  const parseModuleFilter = (moduleKey) => {
    if (moduleKey.includes('-')) {
      const [baseModel, subModule] = moduleKey.split('-');
      const conditions = {};
      switch (moduleKey) {
        case 'game-quiznest': conditions.mode = 'solo'; break;
        case 'game-eventduel': conditions.mode = 'pvp'; break;
        case 'event-eventreg': conditions.eventType = 'public'; break;
        case 'event-checkin': conditions.eventType = 'employee'; break;
      }
      return { baseModel, conditions };
    }
    return { baseModel: moduleKey, conditions: {} };
  };

  const query = {};
  if (deletedBy) query.deletedBy = deletedBy;
  if (startDate || endDate) {
    query.deletedAt = {};
    if (startDate) query.deletedAt.$gte = new Date(startDate);
    if (endDate) query.deletedAt.$lte = new Date(endDate);
  }

  if (user.role === "business") {
    query.$or = [
      { business: user.business },
      { businessId: user.business },
    ];
  }

  let items = [];
  let restoredCount = 0;
  if (module === 'qnquestion') {
    const deletedQuestions = await getDeletedQuestionsFromGames(query, 'solo');

    const gameQuestionMap = new Map();
    deletedQuestions.forEach(question => {
      if (!gameQuestionMap.has(question.gameId.toString())) {
        gameQuestionMap.set(question.gameId.toString(), []);
      }
      gameQuestionMap.get(question.gameId.toString()).push(question._id.toString());
    });

    for (const [gameId, questionIds] of gameQuestionMap) {
      await Game.updateOne(
        { _id: gameId, "questions._id": { $in: questionIds } },
        {
          $unset: {
            "questions.$[elem].isDeleted": "",
            "questions.$[elem].deletedAt": "",
            "questions.$[elem].deletedBy": ""
          }
        },
        { arrayFilters: [{ "elem._id": { $in: questionIds } }] }
      );
      restoredCount += questionIds.length;
    }

    return response(res, 200, `Restored ${restoredCount} items from ${module}`, { restoredCount });
  }

  if (module === 'pvpquestion') {
    const deletedQuestions = await getDeletedQuestionsFromGames(query, 'pvp');

    const gameQuestionMap = new Map();
    deletedQuestions.forEach(question => {
      if (!gameQuestionMap.has(question.gameId.toString())) {
        gameQuestionMap.set(question.gameId.toString(), []);
      }
      gameQuestionMap.get(question.gameId.toString()).push(question._id.toString());
    });

    for (const [gameId, questionIds] of gameQuestionMap) {
      await Game.updateOne(
        { _id: gameId, "questions._id": { $in: questionIds } },
        {
          $unset: {
            "questions.$[elem].isDeleted": "",
            "questions.$[elem].deletedAt": "",
            "questions.$[elem].deletedBy": ""
          }
        },
        { arrayFilters: [{ "elem._id": { $in: questionIds } }] }
      );
      restoredCount += questionIds.length;
    }

    return response(res, 200, `Restored ${restoredCount} items from ${module}`, { restoredCount });
  }

  const { baseModel, conditions } = parseModuleFilter(module);
  const M = models[baseModel?.toLowerCase()];
  if (!M) return response(res, 400, "Invalid module");

  const finalQuery = { ...query, ...conditions };

  if (module === 'registration-eventreg' || module === 'registration-checkin') {
    const allItems = await M.findDeleted(query).populate('eventId');
    items = allItems.filter(item => {
      if (!item.eventId) return false;
      return module === 'registration-eventreg' ?
        item.eventId.eventType === 'public' :
        item.eventId.eventType === 'employee';
    });
  } else if (module === 'gamesession-quiznest' || module === 'gamesession-eventduel') {
    const allItems = await M.findDeleted(query).populate('gameId');
    items = allItems.filter(item => {
      if (!item.gameId) return false;
      return module === 'gamesession-quiznest' ?
        item.gameId.mode === 'solo' :
        item.gameId.mode === 'pvp';
    });
  } else {
    items = await M.findDeleted(finalQuery);
  }

  const backendModule = Object.keys(controllerMap).find(key => {
    const frontendToBackend = {
      'business': 'business',
      'event-checkin': 'checkinevent',
      'registration-checkin': 'checkinregistration',
      'event-eventreg': 'eventregevent',
      'registration-eventreg': 'eventregregistration',
      'game-quiznest': 'qngame',
      'game-eventduel': 'pvpgame',
      'gamesession-quiznest': 'qngamesession',
      'gamesession-eventduel': 'pvpgamesession',
    };
    return frontendToBackend[module] === key || module === key;
  });

  const ctrl = controllerMap[backendModule];
  if (!ctrl?.restore) return response(res, 400, "Restore not implemented for this module");

  for (const item of items) {
    try {
      await ctrl.restore({ params: { id: item._id } }, res, () => { });
      restoredCount++;
    } catch (error) {
      console.error(`Error restoring item ${item._id}:`, error);
    }
  }

  return response(res, 200, `Restored ${restoredCount} items from ${module}`, { restoredCount });
});

// Permanently delete all items of a module
exports.permanentDeleteAllItems = asyncHandler(async (req, res) => {
  const { module } = req.params;
  const { deletedBy, startDate, endDate } = req.query;
  const user = req.user;

  const parseModuleFilter = (moduleKey) => {
    if (moduleKey.includes('-')) {
      const [baseModel, subModule] = moduleKey.split('-');
      const conditions = {};
      switch (moduleKey) {
        case 'game-quiznest': conditions.mode = 'solo'; break;
        case 'game-eventduel': conditions.mode = 'pvp'; break;
        case 'event-eventreg': conditions.eventType = 'public'; break;
        case 'event-checkin': conditions.eventType = 'employee'; break;
      }
      return { baseModel, conditions };
    }
    return { baseModel: moduleKey, conditions: {} };
  };

  const query = {};
  if (deletedBy) query.deletedBy = deletedBy;
  if (startDate || endDate) {
    query.deletedAt = {};
    if (startDate) query.deletedAt.$gte = new Date(startDate);
    if (endDate) query.deletedAt.$lte = new Date(endDate);
  }

  if (user.role === "business") {
    query.$or = [
      { business: user.business },
      { businessId: user.business },
    ];
  }

  let items = [];
  let deletedCount = 0;

  if (module === 'qnquestion') {
    const deletedQuestions = await getDeletedQuestionsFromGames(query, 'solo');

    const gameQuestionMap = new Map();
    deletedQuestions.forEach(question => {
      if (!gameQuestionMap.has(question.gameId.toString())) {
        gameQuestionMap.set(question.gameId.toString(), []);
      }
      gameQuestionMap.get(question.gameId.toString()).push(question._id.toString());
    });

    for (const [gameId, questionIds] of gameQuestionMap) {
      await Game.updateOne(
        { _id: gameId },
        { $pull: { questions: { _id: { $in: questionIds } } } }
      );
      deletedCount += questionIds.length;
    }

    return response(res, 200, `Permanently deleted ${deletedCount} items from ${module}`, { deletedCount });
  }

  if (module === 'pvpquestion') {
    const deletedQuestions = await getDeletedQuestionsFromGames(query, 'pvp');

    const gameQuestionMap = new Map();
    deletedQuestions.forEach(question => {
      if (!gameQuestionMap.has(question.gameId.toString())) {
        gameQuestionMap.set(question.gameId.toString(), []);
      }
      gameQuestionMap.get(question.gameId.toString()).push(question._id.toString());
    });

    for (const [gameId, questionIds] of gameQuestionMap) {
      await Game.updateOne(
        { _id: gameId },
        { $pull: { questions: { _id: { $in: questionIds } } } }
      );
      deletedCount += questionIds.length;
    }

    return response(res, 200, `Permanently deleted ${deletedCount} items from ${module}`, { deletedCount });
  }

  const { baseModel, conditions } = parseModuleFilter(module);
  const M = models[baseModel?.toLowerCase()];
  if (!M) return response(res, 400, "Invalid module");

  const finalQuery = { ...query, ...conditions };

  if (module === 'registration-eventreg' || module === 'registration-checkin') {
    const allItems = await M.findDeleted(query).populate('eventId');
    items = allItems.filter(item => {
      if (!item.eventId) return false;
      return module === 'registration-eventreg' ?
        item.eventId.eventType === 'public' :
        item.eventId.eventType === 'employee';
    });
  } else if (module === 'gamesession-quiznest' || module === 'gamesession-eventduel') {
    const allItems = await M.findDeleted(query).populate('gameId');
    items = allItems.filter(item => {
      if (!item.gameId) return false;
      return module === 'gamesession-quiznest' ?
        item.gameId.mode === 'solo' :
        item.gameId.mode === 'pvp';
    });
  } else {
    items = await M.findDeleted(finalQuery);
  }

  const backendModule = Object.keys(controllerMap).find(key => {
    const frontendToBackend = {
      'business': 'business',
      'event-checkin': 'checkinevent',
      'registration-checkin': 'checkinregistration',
      'event-eventreg': 'eventregevent',
      'registration-eventreg': 'eventregregistration',
      'game-quiznest': 'qngame',
      'game-eventduel': 'pvpgame',
      'gamesession-quiznest': 'qngamesession',
      'gamesession-eventduel': 'pvpgamesession',
    };
    return frontendToBackend[module] === key || module === key;
  });

  const ctrl = controllerMap[backendModule];
  if (!ctrl?.permanentDelete) return response(res, 400, "Permanent delete not implemented for this module");

  let failedDeletions = [];

  for (const item of items) {
    try {
      // For event-eventreg and checkin module, check registration dependency before deletion attempt
      if (module === 'event-eventreg' || module === 'event-checkin') {
        const registrationsCount = await Registration.countDocuments({ eventId: item._id });
        if (registrationsCount > 0) {
          failedDeletions.push({
            id: item._id,
            name: item.name,
            reason: 'Cannot delete an event with existing registrations'
          });
          continue;
        }
      }

      await ctrl.permanentDelete({ params: { id: item._id } }, res, () => { });
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting item ${item._id}:`, error);
      failedDeletions.push({
        id: item._id,
        name: item.name,
        reason: error.message || 'Unknown error'
      });
    }
  }

  // If all deletions failed due to dependencies, return appropriate error
  if (deletedCount === 0 && failedDeletions.length > 0) {
    const hasRegistrationErrors = failedDeletions.some(f =>
      f.reason.includes('existing registrations')
    );
    if (hasRegistrationErrors) {
      return response(res, 400, "Cannot delete events with existing registrations");
    }
    return response(res, 400, `Failed to delete items: ${failedDeletions[0].reason}`);
  }

  // If some succeeded and some failed, return partial success
  if (failedDeletions.length > 0) {
    return response(res, 200, `Partially completed: ${deletedCount} deleted, ${failedDeletions.length} failed`, {
      deletedCount,
      failedCount: failedDeletions.length,
      failures: failedDeletions
    });
  }

  return response(res, 200, `Permanently deleted ${deletedCount} items from ${module}`, { deletedCount });
});