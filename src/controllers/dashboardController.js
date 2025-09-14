const asyncHandler = require("../middlewares/asyncHandler");
const response = require("../utils/response");

// Core Models
const Business = require("../models/Business");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const WalkIn = require("../models/WalkIn");
const Game = require("../models/Game");
const GameSession = require("../models/GameSession");
const Poll = require("../models/Poll");
const SurveyForm = require("../models/SurveyForm");
const SurveyRecipient = require("../models/SurveyRecipient");
const SurveyResponse = require("../models/SurveyResponse");
const Visitor = require("../models/Visitor");
const DisplayMedia = require("../models/DisplayMedia");
const WallConfig = require("../models/WallConfig");

// Extended Models
const User = require("../models/User");
const EventQuestion = require("../models/EventQuestion");
const SpinWheel = require("../models/SpinWheel");
const SpinWheelParticipant = require("../models/SpinWheelParticipant");
const Player = require("../models/Player");

exports.getDashboardStats = asyncHandler(async (req, res) => {
  const user = req.user;
  const isAdmin = user.role === "admin";
  const businessId = !isAdmin ? user.business : null;

  // Optional date filters
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;

  const dateRangeStage = (field) => {
    if (!from && !to) return null;
    const cond = {};
    if (from) cond.$gte = from;
    if (to) cond.$lte = to;
    return { $match: { [field]: cond } };
  };

  const baseActive = { isDeleted: { $ne: true } };
  const baseTrash = { isDeleted: true };

  // Pre-compute event IDs
  const eventMatch = isAdmin ? { ...baseActive } : { ...baseActive, businessId };
  const [publicEvents, employeeEvents] = await Promise.all([
    Event.find({ ...eventMatch, eventType: "public" }, { _id: 1 }).lean(),
    Event.find({ ...eventMatch, eventType: "employee" }, { _id: 1 }).lean(),
  ]);
  const publicEventIds = publicEvents.map((e) => e._id);
  const employeeEventIds = employeeEvents.map((e) => e._id);

  // ---------- ACTIVE COUNTS ----------
  const [
    gamesByMode,
    totalPolls,
    totalSurveyForms,
    surveyRecipients,
    totalSurveyResponses,
    visitorStats,
    totalBusinesses,
    questionStats,
    totalSpinWheels,
    totalSpinWheelParticipants,
  ] = await Promise.all([
    // Games by mode
    Game.aggregate([
      { $match: isAdmin ? baseActive : { ...baseActive, businessId } },
      { $group: { _id: "$mode", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: 3000 }),

    // Polls
    Poll.countDocuments(isAdmin ? baseActive : { ...baseActive, business: businessId }).maxTimeMS(3000),

    // Survey Forms
    SurveyForm.countDocuments(isAdmin ? {} : { businessId }).maxTimeMS(3000),

    // Survey Recipients by status
    SurveyRecipient.aggregate([
      { $match: isAdmin ? {} : { businessId } },
      ...(dateRangeStage("createdAt") ? [dateRangeStage("createdAt")] : []),
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).option({ maxTimeMS: 3000 }),

    // Survey Responses
    SurveyResponse.countDocuments(
      isAdmin
        ? {}
        : {
            formId: {
              $in: await (async () => {
                if (isAdmin) return [];
                const forms = await SurveyForm.find({ businessId }, { _id: 1 })
                  .lean()
                  .maxTimeMS(3000);
                return forms.map((f) => f._id);
              })(),
            },
          }
    ).maxTimeMS(3000),

    // Visitors
    Visitor.aggregate([
      {
        $match: isAdmin
          ? baseActive
          : { ...baseActive, "eventHistory.business": businessId },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          repeat: { $sum: { $cond: [{ $gt: [{ $size: "$eventHistory" }, 1] }, 1, 0] } },
        },
      },
    ]).option({ maxTimeMS: 3000 }),

    isAdmin ? Business.countDocuments(baseActive).maxTimeMS(3000) : Promise.resolve(0),

    // Event Questions
    EventQuestion.aggregate([
      { $match: isAdmin ? baseActive : { ...baseActive, business: businessId } },
      { $group: { _id: "$answered", count: { $sum: 1 } } },
    ]),

    // SpinWheels & Participants
    SpinWheel.countDocuments(isAdmin ? baseActive : { ...baseActive, business: businessId }).maxTimeMS(3000),

    SpinWheelParticipant.countDocuments(baseActive).maxTimeMS(3000),
  ]);

  // Registrations split
  const [publicRegistrations, employeeRegistrations] = await Promise.all([
    publicEventIds.length
      ? Registration.countDocuments({ ...baseActive, eventId: { $in: publicEventIds } })
      : 0,
    employeeEventIds.length
      ? Registration.countDocuments({ ...baseActive, eventId: { $in: employeeEventIds } })
      : 0,
  ]);

  // WalkIns split
  const [publicWalkIns, employeeWalkIns] = await Promise.all([
    publicEventIds.length
      ? WalkIn.countDocuments({ ...baseActive, eventId: { $in: publicEventIds } })
      : 0,
    employeeEventIds.length
      ? WalkIn.countDocuments({ ...baseActive, eventId: { $in: employeeEventIds } })
      : 0,
  ]);

  // Games split
  const soloGamesCount = gamesByMode.find((g) => g._id === "solo")?.count || 0;
  const pvpGamesCount = gamesByMode.find((g) => g._id === "pvp")?.count || 0;
  const [soloGameIds, pvpGameIds] = await Promise.all([
    Game.find({ ...(isAdmin ? baseActive : { ...baseActive, businessId }), mode: "solo" }, { _id: 1 }).lean(),
    Game.find({ ...(isAdmin ? baseActive : { ...baseActive, businessId }), mode: "pvp" }, { _id: 1 }).lean(),
  ]).then(([solos, pvps]) => [solos.map((g) => g._id), pvps.map((g) => g._id)]);

  // Players split
  const [soloPlayers, pvpPlayers] = await Promise.all([
    GameSession.aggregate([
      { $match: { ...baseActive, gameId: { $in: soloGameIds } } },
      { $unwind: "$players" },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
    GameSession.aggregate([
      { $match: { ...baseActive, gameId: { $in: pvpGameIds } } },
      { $unwind: "$players" },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
  ]);
  const soloPlayersCount = soloPlayers[0]?.count || 0;
  const pvpPlayersCount = pvpPlayers[0]?.count || 0;

  // ---------- USERS CLEAN OBJECT ----------
  let userStats;
  if (isAdmin) {
    const rawUsers = await User.aggregate([
      { $match: baseActive },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]);
    userStats = rawUsers.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});
  } else {
    const staffCount = await User.countDocuments({
      ...baseActive,
      business: businessId,
      role: "staff",
    });
    userStats = { staff: staffCount };
  }

  // ---------- EVENT QUESTIONS CLEAN OBJECT ----------
  const eventQuestionStats = questionStats.reduce(
    (acc, q) => {
      if (q._id === true) acc.answered = q.count;
      else acc.unanswered = q.count;
      return acc;
    },
    { answered: 0, unanswered: 0 }
  );

  // ---------- TRASH COUNTS ----------
  const [
    trashEvents,
    trashPublicRegs,
    trashEmployeeRegs,
    trashPublicWalkIns,
    trashEmployeeWalkIns,
    trashGames,
    trashPolls,
    trashSurveyForms,
    trashSurveyResponses,
    trashVisitors,
    trashDisplayMedia,
    trashWallConfigs,
    trashBusinesses,
    trashUsers,
    trashQuestions,
    trashSpinWheels,
    trashSpinWheelParticipants,
  ] = await Promise.all([
    Event.aggregate([{ $match: { ...baseTrash, ...(isAdmin ? {} : { businessId }) } }, { $group: { _id: "$eventType", count: { $sum: 1 } } }]),
    Registration.countDocuments({ ...baseTrash, eventId: { $in: publicEventIds } }),
    Registration.countDocuments({ ...baseTrash, eventId: { $in: employeeEventIds } }),
    WalkIn.countDocuments({ ...baseTrash, eventId: { $in: publicEventIds } }),
    WalkIn.countDocuments({ ...baseTrash, eventId: { $in: employeeEventIds } }),
    Game.aggregate([{ $match: isAdmin ? baseTrash : { ...baseTrash, businessId } }, { $group: { _id: "$mode", count: { $sum: 1 } } }]),
    Poll.countDocuments(isAdmin ? baseTrash : { ...baseTrash, business: businessId }),
    SurveyForm.countDocuments(isAdmin ? baseTrash : { ...baseTrash, businessId }),
    SurveyResponse.countDocuments(baseTrash),
    Visitor.countDocuments(baseTrash),
    DisplayMedia.countDocuments(baseTrash),
    WallConfig.countDocuments(baseTrash),
    isAdmin ? Business.countDocuments(baseTrash) : Promise.resolve(0),
    User.countDocuments(isAdmin ? baseTrash : { ...baseTrash, business: businessId }),
    EventQuestion.countDocuments(isAdmin ? baseTrash : { ...baseTrash, business: businessId }),
    SpinWheel.countDocuments(isAdmin ? baseTrash : { ...baseTrash, business: businessId }),
    SpinWheelParticipant.countDocuments(baseTrash),
  ]);

  const trashPublicEvents = trashEvents.find((e) => e._id === "public")?.count || 0;
  const trashEmployeeEvents = trashEvents.find((e) => e._id === "employee")?.count || 0;
  const trashSoloGames = trashGames.find((g) => g._id === "solo")?.count || 0;
  const trashPvpGames = trashGames.find((g) => g._id === "pvp")?.count || 0;

  // Trash players split
  const [trashSoloPlayers, trashPvpPlayers] = await Promise.all([
    GameSession.aggregate([
      { $match: { ...baseTrash, gameId: { $in: soloGameIds } } },
      { $unwind: "$players" },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
    GameSession.aggregate([
      { $match: { ...baseTrash, gameId: { $in: pvpGameIds } } },
      { $unwind: "$players" },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
  ]);
  const trashSoloPlayersCount = trashSoloPlayers[0]?.count || 0;
  const trashPvpPlayersCount = trashPvpPlayers[0]?.count || 0;

  // ---------- MODULE RESPONSE ----------
  const modules = {
    quiznest: {
      totals: { games: soloGamesCount, players: soloPlayersCount },
      trash: { games: trashSoloGames, players: trashSoloPlayersCount },
    },
    eventduel: {
      totals: { games: pvpGamesCount, players: pvpPlayersCount },
      trash: { games: trashPvpGames, players: trashPvpPlayersCount },
    },
    eventreg: {
      totals: { events: publicEventIds.length, registrations: publicRegistrations, walkins: publicWalkIns },
      trash: { events: trashPublicEvents, registrations: trashPublicRegs, walkins: trashPublicWalkIns },
    },
    checkin: {
      totals: { events: employeeEventIds.length, registrations: employeeRegistrations, walkins: employeeWalkIns },
      trash: { events: trashEmployeeEvents, registrations: trashEmployeeRegs, walkins: trashEmployeeWalkIns },
    },
    stageq: {
      totals: { ...eventQuestionStats, visitors: visitorStats[0]?.total || 0, },
      trash: { Questions: trashQuestions, visitors: trashVisitors },
    },
    mosaicwall: {
      totals: { media: trashDisplayMedia, configs: trashWallConfigs }, // placeholder until active tracked
      trash: { media: trashDisplayMedia, configs: trashWallConfigs },
    },
    eventwheel: {
      totals: { wheels: totalSpinWheels, participants: totalSpinWheelParticipants },
      trash: { wheels: trashSpinWheels, participants: trashSpinWheelParticipants },
    },
    surveyguru: {
      totals: { forms: totalSurveyForms, responses: totalSurveyResponses },
      trash: { forms: trashSurveyForms, responses: trashSurveyResponses },
    },
    votecast: {
      totals: { polls: totalPolls },
      trash: { polls: trashPolls },
    },
    global: {
      totals: { businesses: isAdmin ? totalBusinesses : undefined, users: userStats },
      trash: { businesses: isAdmin ? trashBusinesses : undefined, users: trashUsers },
    },
  };

  // ---------- RESPONSE ----------
  return response(res, 200, "Fetched dashboard stats (by module).", {
    scope: isAdmin ? "superadmin" : "business",
    modules,
    breakdowns: {
      gamesByMode,
      surveyRecipients,
    },
    window: { from, to },
  });
});
