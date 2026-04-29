const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const StageQSession = require("../../models/StageQSession");
const EventQuestion = require("../../models/EventQuestion");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const response = require("../../utils/response");

// GET /stageq/sessions/insights/:slug/summary
exports.getSummary = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const session = await StageQSession.findOne({ slug }).select("_id linkedEventRegId").lean();
  if (!session) return response(res, 404, "Session not found");

  const totalQuestions = await EventQuestion.countDocuments({
    sessionId: session._id,
    deletedAt: { $exists: false },
  });

  const uniqueSubmitterIds = await EventQuestion.distinct("registrationId", {
    sessionId: session._id,
    registrationId: { $ne: null, $exists: true },
    deletedAt: { $exists: false },
  });

  let totalRegistrations = 0;
  let participationRate = 0;

  if (session.linkedEventRegId) {
    totalRegistrations = await Registration.countDocuments({
      eventId: session.linkedEventRegId,
      deletedAt: { $exists: false },
    });
    participationRate =
      totalRegistrations > 0
        ? parseFloat(((uniqueSubmitterIds.length / totalRegistrations) * 100).toFixed(2))
        : 0;
  }

  const topQuestion = await EventQuestion.findOne({
    sessionId: session._id,
    deletedAt: { $exists: false },
  })
    .select("text votes")
    .sort({ votes: -1, createdAt: 1 })
    .lean();

  return response(res, 200, "Session insights summary", {
    totalRegistrations,
    uniqueSubmitters: uniqueSubmitterIds.length,
    participationRate,
    totalQuestions,
    topQuestion: topQuestion ? { text: topQuestion.text, voteCount: topQuestion.votes || 0 } : null,
  });
});

// GET /stageq/sessions/insights/:slug/fields
exports.getAvailableFields = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const session = await StageQSession.findOne({ slug }).select("_id linkedEventRegId").lean();
  if (!session) return response(res, 404, "Session not found");

  const timeFields = [{ name: "questionActivity", label: "Question Activity", type: "time" }];
  const topQuestionFields = [{ name: "topQuestions", label: "Questions by Votes", type: "categorical" }];

  let registrationFields = [];
  if (session.linkedEventRegId) {
    const verifiedSubmitterCount = await EventQuestion.countDocuments({
      sessionId: session._id,
      registrationId: { $ne: null, $exists: true },
      deletedAt: { $exists: false },
    });

    if (verifiedSubmitterCount > 0) {
      const linkedEvent = await Event.findById(session.linkedEventRegId).select("formFields").lean();
      if (linkedEvent?.formFields?.length) {
        registrationFields = linkedEvent.formFields.map(f => ({
          name: f.inputName,
          label: f.label || f.inputName,
          type: "text",
        }));
      } else {
        registrationFields = [
          { name: "fullName", label: "Name", type: "text" },
          { name: "email", label: "Email", type: "text" },
          { name: "phone", label: "Phone", type: "text" },
          { name: "company", label: "Company", type: "text" },
        ];
      }
    }
  }

  return response(res, 200, "Available fields", {
    timeFields,
    topQuestionFields,
    registrationFields,
  });
});

// GET /stageq/sessions/insights/:slug/distribution?fieldName=...&topN=...
exports.getFieldDistribution = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { fieldName, topN } = req.query;
  if (!fieldName) return response(res, 400, "fieldName is required");

  const session = await StageQSession.findOne({ slug }).select("_id linkedEventRegId").lean();
  if (!session) return response(res, 404, "Session not found");

  // Top questions by votes
  if (fieldName === "topQuestions") {
    const limit = topN ? parseInt(topN) : 10;
    const questions = await EventQuestion.find({
      sessionId: session._id,
      deletedAt: { $exists: false },
    })
      .select("text votes")
      .sort({ votes: -1 })
      .limit(limit > 0 ? limit : 0)
      .lean();

    const data = questions.map(q => ({
      label: q.text?.length > 60 ? q.text.slice(0, 60) + "…" : q.text,
      value: q.votes || 0,
    }));
    return response(res, 200, "Top questions by votes", { data });
  }

  // Registration segment distribution among submitters
  if (!session.linkedEventRegId) {
    return response(res, 400, "Session is not linked to an event registration");
  }

  const linkedEvent = await Event.findById(session.linkedEventRegId).select("formFields").lean();
  const isCustomField = linkedEvent?.formFields?.some(f => f.inputName === fieldName);
  const fieldPath = isCustomField ? `customFields.${fieldName}` : fieldName;

  const limit = topN ? parseInt(topN) : 10;

  // Count questions per field value (not registrations per field value)
  const pipeline = [
    {
      $match: {
        sessionId: session._id,
        registrationId: { $ne: null, $exists: true },
        deletedAt: { $exists: false },
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "registrationId",
        foreignField: "_id",
        as: "reg",
      },
    },
    { $unwind: "$reg" },
    { $group: { _id: `$reg.${fieldPath}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    ...(limit > 0 ? [{ $limit: limit }] : []),
  ];

  const rawData = await EventQuestion.aggregate(pipeline);
  const data = rawData.map(d => ({
    label: String(d._id ?? "Unknown"),
    value: d.count,
  }));

  return response(res, 200, "Registration field distribution", { data });
});

// GET /stageq/sessions/insights/:slug/time-distribution
exports.getTimeDistribution = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { startDate, endDate, intervalMinutes } = req.query;

  if (!startDate || !endDate) return response(res, 400, "startDate and endDate are required");

  const session = await StageQSession.findOne({ slug }).select("_id").lean();
  if (!session) return response(res, 404, "Session not found");

  const start = new Date(startDate);
  const end = new Date(endDate);
  const interval = parseInt(intervalMinutes) || 60;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return response(res, 400, "Invalid date format");

  const intervalMs = interval * 60 * 1000;

  const pipeline = [
    {
      $match: {
        sessionId: session._id,
        deletedAt: { $exists: false },
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $project: {
        bucketIndex: {
          $floor: { $divide: [{ $subtract: ["$createdAt", start] }, intervalMs] },
        },
      },
    },
    { $group: { _id: "$bucketIndex", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];

  const rawData = await EventQuestion.aggregate(pipeline);
  const dataMap = new Map(rawData.map(d => [d._id, d.count]));

  const filledData = [];
  let bucketIndex = 0;
  for (let t = start.getTime(); t < end.getTime(); t += intervalMs) {
    filledData.push({
      timestamp: new Date(t).toISOString(),
      count: dataMap.get(bucketIndex) || 0,
    });
    bucketIndex++;
  }

  return response(res, 200, "Question activity over time", {
    intervalMinutes: interval,
    data: filledData,
    total: filledData.reduce((sum, d) => sum + d.count, 0),
  });
});
