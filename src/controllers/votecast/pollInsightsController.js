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
  const uniqueVoterIds = await PollVote.distinct("registrationId", { pollId: poll._id });
  const questionCount = poll.questions?.length || 0;

  let totalRegistrations = 0;
  let participationRate = 0;

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
