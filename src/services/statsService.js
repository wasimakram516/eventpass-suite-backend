const Metrics = require("../models/DashboardMetrics");
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
const User = require("../models/User");
const EventQuestion = require("../models/EventQuestion");
const SpinWheel = require("../models/SpinWheel");
const SpinWheelParticipant = require("../models/SpinWheelParticipant");
const Player = require("../models/Player");

async function recalcMetrics(scope = "superadmin", businessId = null) {
  const isAdmin = scope === "superadmin";

  const baseActive = { isDeleted: { $ne: true } };
  const baseTrash = { isDeleted: true };

  // ---------- EVENTS ----------
  const [eventCounts, trashEventCounts] = await Promise.all([
    Event.aggregate([
      { $match: isAdmin ? baseActive : { ...baseActive, businessId } },
      { $group: { _id: "$eventType", count: { $sum: 1 } } },
    ]),
    Event.aggregate([
      { $match: isAdmin ? baseTrash : { ...baseTrash, businessId } },
      { $group: { _id: "$eventType", count: { $sum: 1 } } },
    ]),
  ]);

  const publicEventsCount =
    eventCounts.find((e) => e._id === "public")?.count || 0;
  const employeeEventsCount =
    eventCounts.find((e) => e._id === "employee")?.count || 0;
  const trashPublicEvents =
    trashEventCounts.find((e) => e._id === "public")?.count || 0;
  const trashEmployeeEvents =
    trashEventCounts.find((e) => e._id === "employee")?.count || 0;

  // ---------- REGISTRATIONS & WALKINS ----------
  const [registrationCounts, trashRegistrationCounts] = await Promise.all([
    Registration.aggregate([
      { $match: baseActive },
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
    Registration.aggregate([
      { $match: baseTrash },
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
  ]);
  const [walkinCounts, trashWalkinCounts] = await Promise.all([
    WalkIn.aggregate([
      { $match: baseActive },
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
    WalkIn.aggregate([
      { $match: baseTrash },
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
  ]);

  const publicRegs =
    registrationCounts.find((r) => r._id === "public")?.count || 0;
  const employeeRegs =
    registrationCounts.find((r) => r._id === "employee")?.count || 0;
  const trashPublicRegs =
    trashRegistrationCounts.find((r) => r._id === "public")?.count || 0;
  const trashEmployeeRegs =
    trashRegistrationCounts.find((r) => r._id === "employee")?.count || 0;

  const publicWalkIns =
    walkinCounts.find((r) => r._id === "public")?.count || 0;
  const employeeWalkIns =
    walkinCounts.find((r) => r._id === "employee")?.count || 0;
  const trashPublicWalkIns =
    trashWalkinCounts.find((r) => r._id === "public")?.count || 0;
  const trashEmployeeWalkIns =
    trashWalkinCounts.find((r) => r._id === "employee")?.count || 0;

  // ---------- GAMES ----------
  const [gameCounts, trashGameCounts] = await Promise.all([
    Game.aggregate([
      { $match: isAdmin ? baseActive : { ...baseActive, businessId } },
      { $group: { _id: "$mode", count: { $sum: 1 } } },
    ]),
    Game.aggregate([
      { $match: isAdmin ? baseTrash : { ...baseTrash, businessId } },
      { $group: { _id: "$mode", count: { $sum: 1 } } },
    ]),
  ]);

  const soloGames = gameCounts.find((g) => g._id === "solo")?.count || 0;
  const pvpGames = gameCounts.find((g) => g._id === "pvp")?.count || 0;
  const trashSoloGames =
    trashGameCounts.find((g) => g._id === "solo")?.count || 0;
  const trashPvpGames =
    trashGameCounts.find((g) => g._id === "pvp")?.count || 0;

  // ---------- SOLO PLAYERS (from GameSessions) ----------
  const soloPlayerAgg = await GameSession.aggregate([
    {
      $lookup: {
        from: "games",
        localField: "gameId",
        foreignField: "_id",
        as: "game",
      },
    },
    { $unwind: "$game" },
    {
      $match: {
        "game.mode": "solo",
        ...(isAdmin
          ? baseActive
          : { ...baseActive, "game.businessId": businessId }),
      },
    },
    { $unwind: "$players" },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  const soloPlayers = soloPlayerAgg[0]?.count || 0;

  // ---------- TRASH SOLO PLAYERS ----------
  const trashSoloPlayerAgg = await GameSession.aggregate([
    {
      $lookup: {
        from: "games",
        localField: "gameId",
        foreignField: "_id",
        as: "game",
      },
    },
    { $unwind: "$game" },
    {
      $match: {
        "game.mode": "solo",
        ...baseTrash, // game session is deleted
        ...(isAdmin ? {} : { "game.businessId": businessId }),
      },
    },
    { $unwind: "$players" },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  const trashSoloPlayers = trashSoloPlayerAgg[0]?.count || 0;

  // ---------- PVP SESSIONS ----------
  const pvpSessionAgg = await GameSession.aggregate([
    {
      $lookup: {
        from: "games",
        localField: "gameId",
        foreignField: "_id",
        as: "game",
      },
    },
    { $unwind: "$game" },
    {
      $match: {
        "game.mode": "pvp",
        ...(isAdmin
          ? baseActive
          : { ...baseActive, "game.businessId": businessId }),
      },
    },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  const pvpSessions = pvpSessionAgg[0]?.count || 0;

  // ---------- TRASH PVP SESSIONS ----------
  const trashPvpSessionAgg = await GameSession.aggregate([
    {
      $lookup: {
        from: "games",
        localField: "gameId",
        foreignField: "_id",
        as: "game",
      },
    },
    { $unwind: "$game" },
    {
      $match: {
        "game.mode": "pvp",
        ...baseTrash, // game session is deleted
        ...(isAdmin ? {} : { "game.businessId": businessId }),
      },
    },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  const trashPvpSessions = trashPvpSessionAgg[0]?.count || 0;

  // ---------- POLLS ----------
  const [totalPolls, trashPolls] = await Promise.all([
    Poll.countDocuments(
      isAdmin ? baseActive : { ...baseActive, business: businessId }
    ),
    Poll.countDocuments(
      isAdmin ? baseTrash : { ...baseTrash, business: businessId }
    ),
  ]);

  // ---------- SURVEY FORMS ----------
  const [totalSurveyForms, trashSurveyForms] = await Promise.all([
    SurveyForm.countDocuments(isAdmin ? {} : { businessId }),
    SurveyForm.countDocuments(
      isAdmin ? baseTrash : { ...baseTrash, business: businessId }
    ),
  ]);

  // SURVEY RESPONSES
  const totalSurveyResponsesAgg = await SurveyResponse.aggregate([
    {
      $lookup: {
        from: "surveyforms",
        localField: "formId",
        foreignField: "_id",
        as: "form",
      },
    },
    { $unwind: "$form" },
    ...(isAdmin ? [] : [{ $match: { "form.businessId": businessId } }]),
    { $count: "count" },
  ]);
  const totalSurveyResponses = totalSurveyResponsesAgg[0]?.count || 0;
  const trashSurveyResponses = await SurveyResponse.countDocuments(baseTrash);

  // SURVEY RECIPIENTS
  const totalSurveyRecipientsAgg = await SurveyRecipient.aggregate([
    {
      $lookup: {
        from: "surveyforms",
        localField: "formId",
        foreignField: "_id",
        as: "form",
      },
    },
    { $unwind: "$form" },
    ...(isAdmin ? [] : [{ $match: { "form.businessId": businessId } }]),
    { $count: "count" },
  ]);
  const totalSurveyRecipients = totalSurveyRecipientsAgg[0]?.count || 0;
  const trashSurveyRecipients = await SurveyRecipient.countDocuments(baseTrash);

  // ---------- SPIN WHEELS ----------
  const [totalSpinWheels, trashSpinWheels] = await Promise.all([
    SpinWheel.countDocuments(
      isAdmin ? baseActive : { ...baseActive, business: businessId }
    ),
    SpinWheel.countDocuments(
      isAdmin ? baseTrash : { ...baseTrash, business: businessId }
    ),
  ]);

  // ---- SpinWheel participants (ACTIVE + TRASH, correctly scoped) ----

  // ACTIVE: participant not deleted AND wheel not deleted; scope by business for non-admin
  const activeParticipantsAgg = await SpinWheelParticipant.aggregate([
    { $match: { isDeleted: { $ne: true } } }, // participant-level
    {
      $lookup: {
        from: "spinwheels",
        localField: "spinWheel",
        foreignField: "_id",
        as: "wheel",
      },
    },
    { $unwind: "$wheel" },
    {
      $match: isAdmin
        ? { "wheel.isDeleted": { $ne: true } }
        : { "wheel.isDeleted": { $ne: true }, "wheel.business": businessId },
    },
    { $group: { _id: "$wheel._id", participants: { $sum: 1 } } },
  ]);

  const totalSpinWheelParticipants = activeParticipantsAgg.reduce(
    (acc, w) => acc + w.participants,
    0
  );

  // TRASH: participant deleted; scope by business for non-admin
  const trashParticipantsAgg = await SpinWheelParticipant.aggregate([
    { $match: { isDeleted: true } }, // participant-level
    {
      $lookup: {
        from: "spinwheels",
        localField: "spinWheel",
        foreignField: "_id",
        as: "wheel",
      },
    },
    { $unwind: "$wheel" },
    {
      $match: isAdmin
        ? {} // show all trash participants
        : { "wheel.business": businessId },
    },
    { $group: { _id: "$wheel._id", participants: { $sum: 1 } } },
  ]);

  const trashSpinWheelParticipants = trashParticipantsAgg.reduce(
    (acc, w) => acc + w.participants,
    0
  );

  // ---------- VISITORS / QUESTIONS ----------
  const [visitorStats, trashVisitors, questionStats, trashQuestions] =
    await Promise.all([
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
            repeat: {
              $sum: { $cond: [{ $gt: [{ $size: "$eventHistory" }, 1] }, 1, 0] },
            },
          },
        },
      ]),
      Visitor.countDocuments(
        isAdmin
          ? baseTrash
          : { ...baseTrash, "eventHistory.business": businessId }
      ),
      EventQuestion.aggregate([
        {
          $match: isAdmin
            ? baseActive
            : { ...baseActive, business: businessId },
        },
        { $group: { _id: "$answered", count: { $sum: 1 } } },
      ]),
      EventQuestion.countDocuments(
        isAdmin ? baseTrash : { ...baseTrash, business: businessId }
      ),
    ]);

  const eventQuestionStats = questionStats.reduce(
    (acc, q) => {
      if (q._id === true) acc.answered = q.count;
      else acc.unanswered = q.count;
      return acc;
    },
    { answered: 0, unanswered: 0 }
  );

  // ---------- DISPLAY MEDIA / WALL CONFIG ----------
  const [
    totalDisplayMedia,
    trashDisplayMedia,
    totalWallConfigs,
    trashWallConfigs,
  ] = await Promise.all([
    DisplayMedia.countDocuments(
      isAdmin ? baseActive : { ...baseActive, business: businessId }
    ),
    DisplayMedia.countDocuments(baseTrash),
    WallConfig.countDocuments(
      isAdmin ? baseActive : { ...baseActive, business: businessId }
    ),
    WallConfig.countDocuments(baseTrash),
  ]);

  // ---------- USERS / BUSINESSES ----------
  let userStats = { admin: 0, business: 0, staff: 0 };
  let trashUserStats = { admin: 0, business: 0, staff: 0 };
  let totalBusinesses = 0;
  let trashBusinesses = 0;

  if (isAdmin) {
    const [users, trashUsersAgg, biz, trashB] = await Promise.all([
      User.aggregate([
        { $match: baseActive },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $match: baseTrash },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
      Business.countDocuments(baseActive),
      Business.countDocuments(baseTrash),
    ]);

    users.forEach((u) => (userStats[u._id] = u.count));
    trashUsersAgg.forEach((u) => (trashUserStats[u._id] = u.count));

    totalBusinesses = biz;
    trashBusinesses = trashB;
  } else {
    const staffCount = await User.countDocuments({
      ...baseActive,
      business: businessId,
      role: "staff",
    });
    const trashStaffCount = await User.countDocuments({
      ...baseTrash,
      business: businessId,
      role: "staff",
    });

    userStats = { staff: staffCount };
    trashUserStats = { staff: trashStaffCount };

    totalBusinesses = 0;
    trashBusinesses = 0;
  }

  // ---------- MODULE RESPONSE ----------
  const modules = {
    quiznest: {
      totals: {
        games: soloGames,
        players: soloPlayers,
      },
      trash: {
        games: trashSoloGames,
        players: trashSoloPlayers,
      },
    },
    eventduel: {
      totals: { games: pvpGames, sessions: pvpSessions },
      trash: { games: trashPvpGames, sessions: trashPvpSessions },
    },

    eventreg: {
      totals: {
        events: publicEventsCount,
        registrations: publicRegs,
        walkins: publicWalkIns,
      },
      trash: {
        events: trashPublicEvents,
        registrations: trashPublicRegs,
        walkins: trashPublicWalkIns,
      },
    },
    checkin: {
      totals: {
        events: employeeEventsCount,
        registrations: employeeRegs,
        walkins: employeeWalkIns,
      },
      trash: {
        events: trashEmployeeEvents,
        registrations: trashEmployeeRegs,
        walkins: trashEmployeeWalkIns,
      },
    },
    stageq: {
      totals: {
        answered: eventQuestionStats.answered,
        unanswered: eventQuestionStats.unanswered,
        visitors: visitorStats[0]?.total || 0,
        repeatVisitors: visitorStats[0]?.repeat || 0,
      },
      trash: {
        questions: trashQuestions,
        visitors: trashVisitors,
      },
    },

    mosaicwall: {
      totals: { configs: totalWallConfigs, media: totalDisplayMedia },
      trash: { configs: trashWallConfigs, media: trashDisplayMedia },
    },
    eventwheel: {
      totals: {
        wheels: totalSpinWheels,
        participants: totalSpinWheelParticipants,
      },
      trash: {
        wheels: trashSpinWheels,
        participants: trashSpinWheelParticipants,
      },
    },
    surveyguru: {
      totals: {
        forms: totalSurveyForms,
        responses: totalSurveyResponses,
        recipients: totalSurveyRecipients,
      },
      trash: {
        forms: trashSurveyForms,
        responses: trashSurveyResponses,
        recipients: trashSurveyRecipients,
      },
    },
    votecast: { totals: { polls: totalPolls }, trash: { polls: trashPolls } },
    global: {
      totals: { businesses: totalBusinesses, users: userStats },
      trash: { businesses: trashBusinesses, users: trashUserStats },
    },
  };

  // ---------- UPSERT METRICS ----------
  await Metrics.findOneAndUpdate(
    { scope, businessId },
    { modules, lastUpdated: new Date() },
    { upsert: true, new: true }
  );

  return { scope, businessId, modules, lastUpdated: new Date() };
}

module.exports = { recalcMetrics };
