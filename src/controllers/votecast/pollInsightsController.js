const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Poll = require("../../models/Poll");
const PollVote = require("../../models/PollVote");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const response = require("../../utils/response");

// GET /votecast/polls/insights/:slug/summary
exports.getSummary = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const poll = await Poll.findOne({ slug }).select("_id linkedEventRegId questions").lean();
  if (!poll) return response(res, 404, "Poll not found");

  const totalVotes = await PollVote.countDocuments({ pollId: poll._id });
  const voterField = poll.linkedEventRegId ? "registrationId" : "sessionToken";
  const voterFilter = poll.linkedEventRegId
    ? { pollId: poll._id, registrationId: { $exists: true, $ne: null } }
    : { pollId: poll._id, sessionToken: { $exists: true, $ne: null } };
  const uniqueVoterIds = await PollVote.distinct(voterField, voterFilter);
  const questionCount = poll.questions?.length || 0;

  let totalRegistrations = null;
  let participationRate = null;

  if (poll.linkedEventRegId) {
    totalRegistrations = await Registration.countDocuments({
      eventId: poll.linkedEventRegId,
      deletedAt: { $exists: false },
    });
    participationRate =
      totalRegistrations > 0
        ? parseFloat(((uniqueVoterIds.length / totalRegistrations) * 100).toFixed(2))
        : 0;
  }

  return response(res, 200, "Poll insights summary", {
    totalRegistrations,
    uniqueVoters: uniqueVoterIds.length,
    participationRate,
    totalVotes,
    questionCount,
  });
});

// GET /votecast/polls/insights/:slug/fields
exports.getAvailableFields = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const poll = await Poll.findOne({ slug }).select("linkedEventRegId questions").lean();
  if (!poll) return response(res, 404, "Poll not found");

  // Each question is a categorical field (vote distribution per option)
  const categoricalFields = (poll.questions || []).map((q) => ({
    name: `question_${q._id}`,
    label: q.question,
    type: "categorical",
  }));

  // Voting activity over time
  const timeFields = [{ name: "votingActivity", label: "Voting Activity", type: "time" }];

  // Registration segment fields if poll is linked to an EventReg event
  let registrationFields = [];
  if (poll.linkedEventRegId) {
    // Only expose registration fields if there are verified voters (non-null registrationId)
    const verifiedVoterCount = await PollVote.countDocuments({
      pollId: poll._id,
      registrationId: { $ne: null, $exists: true },
    });

    if (verifiedVoterCount > 0) {
      const linkedEvent = await Event.findById(poll.linkedEventRegId)
        .select("formFields")
        .lean();
      if (linkedEvent?.formFields?.length) {
        // Custom-field event
        registrationFields = linkedEvent.formFields.map((f) => ({
          name: f.inputName,
          label: f.label || f.inputName,
          type: "text",
        }));
      } else {
        // Classic-field event — expose standard registration fields
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
    categoricalFields,
    timeFields,
    registrationFields,
  });
});

// GET /votecast/polls/insights/:slug/distribution?fieldName=...&topN=...
exports.getFieldDistribution = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { fieldName, topN } = req.query;

  if (!fieldName) return response(res, 400, "fieldName is required");

  const poll = await Poll.findOne({ slug }).select("_id questions linkedEventRegId").lean();
  if (!poll) return response(res, 404, "Poll not found");

  // Question vote distribution
  if (fieldName.startsWith("question_")) {
    const questionId = fieldName.replace("question_", "");
    const question = poll.questions.find((q) => String(q._id) === questionId);
    if (!question) return response(res, 404, "Question not found");

    const limit = topN ? parseInt(topN) : 0;
    let data = (question.options || [])
      .map((o) => ({ label: o.text || "Option", value: o.votes || 0 }))
      .sort((a, b) => b.value - a.value);

    if (limit > 0) data = data.slice(0, limit);

    return response(res, 200, "Question vote distribution", { data });
  }

  // Registration segment distribution among voters
  if (!poll.linkedEventRegId) {
    return response(res, 400, "Poll is not linked to an event registration");
  }

  const linkedEvent = await Event.findById(poll.linkedEventRegId)
    .select("formFields")
    .lean();
  const isCustomField = linkedEvent?.formFields?.some((f) => f.inputName === fieldName);
  const fieldPath = isCustomField ? `customFields.${fieldName}` : fieldName;

  const voterRegIds = await PollVote.distinct("registrationId", { pollId: poll._id });
  const limit = topN ? parseInt(topN) : 10;

  const pipeline = [
    {
      $match: {
        _id: { $in: voterRegIds },
        eventId: poll.linkedEventRegId,
        deletedAt: { $exists: false },
      },
    },
    { $group: { _id: `$${fieldPath}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    ...(limit > 0 ? [{ $limit: limit }] : []),
  ];

  const rawData = await Registration.aggregate(pipeline);
  const data = rawData.map((d) => ({
    label: String(d._id ?? "Unknown"),
    value: d.count,
  }));

  return response(res, 200, "Registration field distribution", { data });
});

// GET /votecast/polls/insights/:slug/time-distribution
exports.getTimeDistribution = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { startDate, endDate, intervalMinutes } = req.query;

  if (!startDate || !endDate)
    return response(res, 400, "startDate and endDate are required");

  const poll = await Poll.findOne({ slug }).select("_id").lean();
  if (!poll) return response(res, 404, "Poll not found");

  const start = new Date(startDate);
  const end = new Date(endDate);
  const interval = parseInt(intervalMinutes) || 60;

  if (isNaN(start.getTime()) || isNaN(end.getTime()))
    return response(res, 400, "Invalid date format");

  const intervalMs = interval * 60 * 1000;

  const pipeline = [
    { $match: { pollId: poll._id, votedAt: { $gte: start, $lte: end } } },
    {
      $project: {
        bucketIndex: {
          $floor: { $divide: [{ $subtract: ["$votedAt", start] }, intervalMs] },
        },
      },
    },
    { $group: { _id: "$bucketIndex", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];

  const rawData = await PollVote.aggregate(pipeline);
  const dataMap = new Map(rawData.map((d) => [d._id, d.count]));

  const filledData = [];
  let bucketIndex = 0;
  for (let t = start.getTime(); t < end.getTime(); t += intervalMs) {
    filledData.push({
      timestamp: new Date(t).toISOString(),
      count: dataMap.get(bucketIndex) || 0,
    });
    bucketIndex++;
  }

  return response(res, 200, "Voting activity over time", {
    intervalMinutes: interval,
    data: filledData,
    total: filledData.reduce((sum, d) => sum + d.count, 0),
  });
});

// GET /votecast/polls/insights/:slug/cross-breakdown?fieldName=&questionId=
exports.getCrossBreakdown = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { fieldName, questionId } = req.query;

  if (!fieldName) return response(res, 400, "fieldName is required");
  if (!questionId) return response(res, 400, "questionId is required");

  const poll = await Poll.findOne({ slug }).select("_id questions linkedEventRegId").lean();
  if (!poll) return response(res, 404, "Poll not found");
  if (!poll.linkedEventRegId) return response(res, 400, "Poll is not linked to an event registration");

  let qId;
  try {
    qId = new mongoose.Types.ObjectId(questionId);
  } catch {
    return response(res, 400, "Invalid questionId");
  }

  const question = poll.questions.find((q) => String(q._id) === questionId);
  if (!question) return response(res, 404, "Question not found");

  const linkedEvent = await Event.findById(poll.linkedEventRegId).select("formFields").lean();
  const isCustomField = linkedEvent?.formFields?.some((f) => f.inputName === fieldName);
  const fieldPath = isCustomField ? `customFields.${fieldName}` : fieldName;

  const pipeline = [
    {
      $match: {
        pollId: poll._id,
        questionId: qId,
        registrationId: { $exists: true, $ne: null },
      },
    },
    {
      $lookup: {
        from: "registrations",
        localField: "registrationId",
        foreignField: "_id",
        as: "registration",
      },
    },
    { $unwind: { path: "$registration", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          fieldValue: `$registration.${fieldPath}`,
          optionIndex: "$optionIndex",
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.fieldValue": 1, "_id.optionIndex": 1 } },
  ];

  const rawData = await PollVote.aggregate(pipeline);

  const normalizeFieldValue = (val) =>
    val == null || val === "" ? "Unknown" : String(val);

  const fieldValuesSet = new Set(rawData.map((d) => normalizeFieldValue(d._id.fieldValue)));
  const fieldValues = [...fieldValuesSet].sort();

  const options = (question.options || []).map((o, idx) => ({
    index: idx,
    text: o.text || `Option ${idx + 1}`,
  }));

  const segments = fieldValues.map((fv) => ({
    fieldValue: fv,
    distribution: options.map((opt) => {
      const match = rawData.find(
        (d) => normalizeFieldValue(d._id.fieldValue) === fv && d._id.optionIndex === opt.index
      );
      return { optionIndex: opt.index, optionText: opt.text, count: match ? match.count : 0 };
    }),
  }));

  return response(res, 200, "Cross breakdown data", {
    questionId,
    questionText: question.question,
    options,
    segments,
  });
});
