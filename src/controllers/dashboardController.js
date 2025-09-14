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
const User = require("../models/User");
const EventQuestion = require("../models/EventQuestion");
const SpinWheel = require("../models/SpinWheel");
const SpinWheelParticipant = require("../models/SpinWheelParticipant");
const Player = require("../models/Player");

exports.getDashboardStats = asyncHandler(async (req, res) => {
  const user = req.user;
  const isAdmin = user.role === "admin";
  const businessId = !isAdmin ? user.business : null;

  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;

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

  const publicEventsCount = eventCounts.find(e => e._id === "public")?.count || 0;
  const employeeEventsCount = eventCounts.find(e => e._id === "employee")?.count || 0;
  const trashPublicEvents = trashEventCounts.find(e => e._id === "public")?.count || 0;
  const trashEmployeeEvents = trashEventCounts.find(e => e._id === "employee")?.count || 0;

  // ---------- REGISTRATIONS & WALKINS ----------
  const [registrationCounts, trashRegistrationCounts] = await Promise.all([
    Registration.aggregate([
      { $match: baseActive },
      { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
    Registration.aggregate([
      { $match: baseTrash },
      { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
  ]);
  const [walkinCounts, trashWalkinCounts] = await Promise.all([
    WalkIn.aggregate([
      { $match: baseActive },
      { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
    WalkIn.aggregate([
      { $match: baseTrash },
      { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
      { $unwind: "$event" },
      { $match: isAdmin ? {} : { "event.businessId": businessId } },
      { $group: { _id: "$event.eventType", count: { $sum: 1 } } },
    ]),
  ]);

  const publicRegs = registrationCounts.find(r => r._id === "public")?.count || 0;
  const employeeRegs = registrationCounts.find(r => r._id === "employee")?.count || 0;
  const trashPublicRegs = trashRegistrationCounts.find(r => r._id === "public")?.count || 0;
  const trashEmployeeRegs = trashRegistrationCounts.find(r => r._id === "employee")?.count || 0;

  const publicWalkIns = walkinCounts.find(r => r._id === "public")?.count || 0;
  const employeeWalkIns = walkinCounts.find(r => r._id === "employee")?.count || 0;
  const trashPublicWalkIns = trashWalkinCounts.find(r => r._id === "public")?.count || 0;
  const trashEmployeeWalkIns = trashWalkinCounts.find(r => r._id === "employee")?.count || 0;

  // ---------- GAMES & PLAYERS ----------
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

  const [playerCounts, trashPlayerCounts] = await Promise.all([
    Player.aggregate([
      { $match: baseActive },
      { $lookup: { from: "games", localField: "gameId", foreignField: "_id", as: "game" } },
      { $unwind: "$game" },
      { $match: isAdmin ? {} : { "game.businessId": businessId } },
      { $group: { _id: "$game.mode", count: { $sum: 1 } } },
    ]),
    Player.aggregate([
      { $match: baseTrash },
      { $lookup: { from: "games", localField: "gameId", foreignField: "_id", as: "game" } },
      { $unwind: "$game" },
      { $match: isAdmin ? {} : { "game.businessId": businessId } },
      { $group: { _id: "$game.mode", count: { $sum: 1 } } },
    ]),
  ]);

  const soloGames = gameCounts.find(g => g._id === "solo")?.count || 0;
  const pvpGames = gameCounts.find(g => g._id === "pvp")?.count || 0;
  const trashSoloGames = trashGameCounts.find(g => g._id === "solo")?.count || 0;
  const trashPvpGames = trashGameCounts.find(g => g._id === "pvp")?.count || 0;

  const soloPlayers = playerCounts.find(p => p._id === "solo")?.count || 0;
  const pvpPlayers = playerCounts.find(p => p._id === "pvp")?.count || 0;
  const trashSoloPlayers = trashPlayerCounts.find(p => p._id === "solo")?.count || 0;
  const trashPvpPlayers = trashPlayerCounts.find(p => p._id === "pvp")?.count || 0;

  // ---------- SURVEYS / POLLS / SPINWHEELS ----------
  const [
    totalPolls,
    trashPolls,
    totalSurveyForms,
    trashSurveyForms,
    totalSurveyResponses,
    trashSurveyResponses,
    totalSpinWheels,
    trashSpinWheels,
    totalSpinWheelParticipants,
    trashSpinWheelParticipants,
  ] = await Promise.all([
    Poll.countDocuments(isAdmin ? baseActive : { ...baseActive, business: businessId }),
    Poll.countDocuments(isAdmin ? baseTrash : { ...baseTrash, business: businessId }),
    SurveyForm.countDocuments(isAdmin ? {} : { businessId }),
    SurveyForm.countDocuments(isAdmin ? baseTrash : { ...baseTrash, businessId }),
    SurveyResponse.countDocuments(isAdmin ? {} : { businessId }),
    SurveyResponse.countDocuments(baseTrash),
    SpinWheel.countDocuments(isAdmin ? baseActive : { ...baseActive, business: businessId }),
    SpinWheel.countDocuments(isAdmin ? baseTrash : { ...baseTrash, businessId }),
    SpinWheelParticipant.countDocuments(baseActive),
    SpinWheelParticipant.countDocuments(baseTrash),
  ]);

  // ---------- VISITORS / QUESTIONS ----------
  const [visitorStats, trashVisitors, questionStats, trashQuestions] = await Promise.all([
    Visitor.aggregate([
      { $match: isAdmin ? baseActive : { ...baseActive, "eventHistory.business": businessId } },
      { $group: { _id: null, total: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: [{ $size: "$eventHistory" }, 1] }, 1, 0] } } } },
    ]),
    Visitor.countDocuments(baseTrash),
    EventQuestion.aggregate([
      { $match: isAdmin ? baseActive : { ...baseActive, business: businessId } },
      { $group: { _id: "$answered", count: { $sum: 1 } } },
    ]),
    EventQuestion.countDocuments(isAdmin ? baseTrash : { ...baseTrash, business: businessId }),
  ]);

  const eventQuestionStats = questionStats.reduce(
    (acc, q) => {
      if (q._id === true) acc.answered = q.count;
      else acc.unanswered = q.count;
      return acc;
    },
    { answered: 0, unanswered: 0 }
  );

  // ---------- USERS / BUSINESSES ----------
  let userStats, trashUsers, totalBusinesses, trashBusinesses;
  if (isAdmin) {
    const [users, trashU, biz, trashB] = await Promise.all([
      User.aggregate([{ $match: baseActive }, { $group: { _id: "$role", count: { $sum: 1 } } }]),
      User.countDocuments(baseTrash),
      Business.countDocuments(baseActive),
      Business.countDocuments(baseTrash),
    ]);
    userStats = users.reduce((acc, cur) => ({ ...acc, [cur._id]: cur.count }), {});
    trashUsers = trashU;
    totalBusinesses = biz;
    trashBusinesses = trashB;
  } else {
    const staffCount = await User.countDocuments({ ...baseActive, business: businessId, role: "staff" });
    userStats = { staff: staffCount };
    trashUsers = await User.countDocuments({ ...baseTrash, business: businessId });
    totalBusinesses = 0;
    trashBusinesses = 0;
  }

  // ---------- DISPLAY MEDIA / WALL CONFIG ----------
  const [trashDisplayMedia, trashWallConfigs] = await Promise.all([
    DisplayMedia.countDocuments(baseTrash),
    WallConfig.countDocuments(baseTrash),
  ]);

  // ---------- MODULE RESPONSE ----------
  const modules = {
    quiznest: { totals: { games: soloGames, players: soloPlayers }, trash: { games: trashSoloGames, players: trashSoloPlayers } },
    eventduel: { totals: { games: pvpGames, players: pvpPlayers }, trash: { games: trashPvpGames, players: trashPvpPlayers } },
    eventreg: { totals: { events: publicEventsCount, registrations: publicRegs, walkins: publicWalkIns }, trash: { events: trashPublicEvents, registrations: trashPublicRegs, walkins: trashPublicWalkIns } },
    checkin: { totals: { events: employeeEventsCount, registrations: employeeRegs, walkins: employeeWalkIns }, trash: { events: trashEmployeeEvents, registrations: trashEmployeeRegs, walkins: trashEmployeeWalkIns } },
    stageq: { totals: { ...eventQuestionStats, visitors: visitorStats[0]?.total || 0 }, trash: { questions: trashQuestions, visitors: trashVisitors } },
    mosaicwall: { totals: { media: trashDisplayMedia, configs: trashWallConfigs }, trash: { media: trashDisplayMedia, configs: trashWallConfigs } },
    eventwheel: { totals: { wheels: totalSpinWheels, participants: totalSpinWheelParticipants }, trash: { wheels: trashSpinWheels, participants: trashSpinWheelParticipants } },
    surveyguru: { totals: { forms: totalSurveyForms, responses: totalSurveyResponses }, trash: { forms: trashSurveyForms, responses: trashSurveyResponses } },
    votecast: { totals: { polls: totalPolls }, trash: { polls: trashPolls } },
    global: { totals: { businesses: totalBusinesses, users: userStats }, trash: { businesses: trashBusinesses, users: trashUsers } },
  };

  return response(res, 200, "Fetched dashboard stats (by module).", {
    scope: isAdmin ? "superadmin" : "business",
    modules,
    window: { from, to },
  });
});
