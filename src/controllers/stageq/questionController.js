const Business = require("../../models/Business");
const EventQuestion = require("../../models/EventQuestion");
const Visitor = require("../../models/Visitor");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");

// GET all questions for a business
exports.getQuestionsByBusiness = asyncHandler(async (req, res) => {
  const { businessSlug } = req.params;

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const questions = await EventQuestion.find({ business: business._id }).notDeleted()
    .populate("visitor", "name phone company")
    .sort({ createdAt: -1 });

  return response(res, 200, "Questions fetched", questions);
});

// POST a new public question (no auth)
exports.submitQuestion = asyncHandler(async (req, res) => {
  const { businessSlug } = req.params;
  const { name, phone, company, text } = req.body;

  if (!name || !text)
    return response(res, 400, "Name and question are required");

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  let visitor = await Visitor.findOne({ name, phone }).notDeleted();
  if (!visitor) {
    visitor = await Visitor.create({
      name,
      phone,
      company,
      eventHistory: [{ business: business._id, count: 1, lastInteraction: new Date() }],
    });
  } else {
    const existing = visitor.eventHistory.find(
      (e) => e.business.toString() === business._id.toString()
    ).notDeleted();
    if (existing) {
      existing.count += 1;
      existing.lastInteraction = new Date();
    } else {
      visitor.eventHistory.push({ business: business._id, count: 1, lastInteraction: new Date() });
    }
    await visitor.save();
  }

  const question = await EventQuestion.create({
    business: business._id,
    text,
    visitor: visitor._id,
  });

  const populated = await question.populate("visitor", "name company");
  return response(res, 201, "Question submitted", populated);
});

// PUT: Mark answered or update text
exports.updateQuestion = asyncHandler(async (req, res) => {
  const { questionId } = req.params;
  const { answered, text } = req.body;
  const user = req.user;

  const question = await EventQuestion.findById(questionId).populate("business").notDeleted();
  if (!question) return response(res, 404, "Question not found");

  const isAdmin = user.role === "admin";
  const isOwner = String(question.business.owner) === user.id;

  if (!isAdmin && !isOwner) return response(res, 403, "Not authorized");

  if (answered !== undefined) question.answered = answered;
  if (text) question.text = text;

  await question.save();
  return response(res, 200, "Question updated", question);
});

// Soft delete question
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const { questionId } = req.params;
  const user = req.user;

  const question = await EventQuestion.findById(questionId).populate("business");
  if (!question) return response(res, 404, "Question not found");

  const isAdmin = user.role === "admin";
  const isOwner = String(question.business.owner) === user.id;
  if (!isAdmin && !isOwner) return response(res, 403, "Not authorized");

  await question.softDelete(req.user.id);
  return response(res, 200, "Question moved to recycle bin");
});

// Restore question
exports.restoreQuestion = asyncHandler(async (req, res) => {
  const question = await EventQuestion.findOneDeleted({ _id: req.params.questionId });
  if (!question) return response(res, 404, "Question not found in trash");

  await question.restore();
  return response(res, 200, "Question restored", question);
});

// Permanent delete
exports.permanentDeleteQuestion = asyncHandler(async (req, res) => {
  const question = await EventQuestion.findOneDeleted({ _id: req.params.questionId });
  if (!question) return response(res, 404, "Question not found in trash");

  await question.deleteOne();
  return response(res, 200, "Question permanently deleted");
});

// PUT: Vote (add/remove)
exports.voteQuestion = asyncHandler(async (req, res) => {
  const { questionId } = req.params;
  const { action } = req.body;

  const question = await EventQuestion.findById(questionId);
  if (!question) return response(res, 404, "Question not found");

  if (action === "add") {
    question.votes += 1;
  } else if (action === "remove") {
    question.votes = Math.max(0, question.votes - 1);
  } else {
    return response(res, 400, "Invalid action");
  }

  await question.save();
  return response(res, 200, "Vote updated", { votes: question.votes });
});
