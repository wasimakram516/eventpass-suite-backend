const Business = require("../../models/Business");
const EventQuestion = require("../../models/EventQuestion");
const Visitor = require("../../models/Visitor");
const StageQSession = require("../../models/StageQSession");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { emitToRoom } = require("../../utils/socketUtils");
const { roomKey } = require("../../socket/modules/stageq/stageqSocket");

// GET all questions for a business
exports.getQuestionsByBusiness = asyncHandler(async (req, res) => {
  const { businessSlug } = req.params;

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const questions = await EventQuestion.find({ business: business._id })
    
    .populate("visitor", "name phone company")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ createdAt: -1 });

  return response(res, 200, "Questions fetched", questions);
});

// POST a new public question (no auth)
exports.submitQuestion = asyncHandler(async (req, res) => {
  const { businessSlug } = req.params;
  const { name, phone, company, text } = req.body;

  if (!name || !text)
    return response(res, 400, "Name and question are required");

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  let visitor = await Visitor.findOne({ name, phone });
  if (!visitor) {
    visitor = await Visitor.create({
      name,
      phone,
      company,
      eventHistory: [
        { business: business._id, count: 1, lastInteraction: new Date() },
      ],
    });
  } else {
    const existing = visitor.eventHistory.find(
      (e) => e.business.toString() === business._id.toString()
    );

    if (existing) {
      existing.count += 1;
      existing.lastInteraction = new Date();
    } else {
      visitor.eventHistory.push({
        business: business._id,
        count: 1,
        lastInteraction: new Date(),
      });
    }
    await visitor.save();
  }

  const question = await EventQuestion.create({
    business: business._id,
    text,
    visitor: visitor._id,
  });

  // Fire background recompute
  recomputeAndEmit(business._id || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await question.populate("visitor", "name company");
  return response(res, 201, "Question submitted", populated);
});

// PUT: Mark answered or update text
exports.updateQuestion = asyncHandler(async (req, res) => {
  const { questionId } = req.params;
  const { answered, text } = req.body;
  const user = req.user;

  const question = await EventQuestion.findById(questionId)
    .populate("business")
    ;
  if (!question) return response(res, 404, "Question not found");

  const isAdmin = user.role === "admin" || user.role === "superadmin";
  const isOwner = String(question.business.owner) === user.id;

  if (!isAdmin && !isOwner) return response(res, 403, "Not authorized");

  if (answered !== undefined) question.answered = answered;
  if (text) question.text = text;

  question.setAuditUser(req.user);
  await question.save();

  if (question.sessionId && answered !== undefined) {
    const session = await StageQSession.findById(question.sessionId).select("slug").lean();
    if (session) {
      const payload = { questionId: question._id, answered: question.answered };
      if (!question.answered) {
        const populated = await EventQuestion.findById(question._id)
          .populate("registrationId", "fullName company phone isoCode customFields")
          .lean();
        if (populated) {
          const reg = populated.registrationId;
          if (reg) {
            const cf = reg.customFields instanceof Map
              ? Object.fromEntries(reg.customFields)
              : (reg.customFields || {});
            populated.submitterName = reg.fullName || cf.Name || cf.name || cf.fullName || cf.full_name || null;
            populated.submitterCompany = reg.company || cf.Company || cf.company || cf.organization || cf.Organization || null;
          }
          payload.question = populated;
        }
      }
      emitToRoom(roomKey(session.slug), "questionAnsweredUpdated", payload);
    }
  }

  // Fire background recompute
  recomputeAndEmit(question.business._id || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question updated", question);
});

// Soft delete question
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const { questionId } = req.params;
  const user = req.user;

  const question = await EventQuestion.findById(questionId).populate(
    "business"
  );
  if (!question) return response(res, 404, "Question not found");

  const isAdmin = user.role === "admin" || user.role === "superadmin";
  const isOwner = String(question.business.owner) === user.id;
  if (!isAdmin && !isOwner) return response(res, 403, "Not authorized");

  await question.softDelete(req.user.id);

  // Fire background recompute
  recomputeAndEmit(question.business._id || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question moved to recycle bin");
});

// Restore question
exports.restoreQuestion = asyncHandler(async (req, res) => {
  const question = await EventQuestion.findOneDeleted({ _id: req.params.id });
  if (!question) return response(res, 404, "Question not found in trash");

  await question.restore();

  // Fire background recompute
  recomputeAndEmit(question.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question restored", question);
});

// Permanent delete
exports.permanentDeleteQuestion = asyncHandler(async (req, res) => {
  const question = await EventQuestion.findOneDeleted({ _id: req.params.id });
  if (!question) return response(res, 404, "Question not found in trash");

  await question.deleteOne();

  // Fire background recompute
  recomputeAndEmit(question.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Question permanently deleted");
});

// Restore all questions
exports.restoreAllQuestions = asyncHandler(async (req, res) => {
  const questions = await EventQuestion.findDeleted();
  if (!questions.length) {
    return response(res, 404, "No questions found in trash to restore");
  }

  for (const question of questions) {
    await question.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${questions.length} questions`);
});

// Permanently delete all questions
exports.permanentDeleteAllQuestions = asyncHandler(async (req, res) => {
  const questions = await EventQuestion.findDeleted();
  if (!questions.length) {
    return response(res, 404, "No questions found in trash to delete");
  }

  for (const question of questions) {
    await question.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Permanently deleted ${questions.length} questions`
  );
});

// Helper: extract a field value from classic or custom fields
const extractField = (reg, classicKey, customKeys, primaryField = null, formFields = []) => {
  if (reg[classicKey]) return reg[classicKey];
  const cf = reg.customFields instanceof Map
    ? Object.fromEntries(reg.customFields)
    : (reg.customFields || {});
  if (cf[classicKey]) return cf[classicKey];
  for (const key of customKeys) {
    if (cf[key]) return cf[key];
  }
  for (const field of formFields) {
    const label = (field.label || "").toLowerCase();
    const inputName = (field.inputName || "").toLowerCase();
    if (label.includes(classicKey.toLowerCase()) || inputName.includes(classicKey.toLowerCase())) {
      if (cf[field.inputName]) return cf[field.inputName];
    }
  }
  if (primaryField && cf[primaryField]) return cf[primaryField];
  return null;
};

// GET all questions for a session (by session slug)
exports.getQuestionsBySession = asyncHandler(async (req, res) => {
  const { sessionSlug } = req.params;

  const session = await StageQSession.findOne({ slug: sessionSlug }).select("_id linkedEventRegId primaryField").lean();
  if (!session) return response(res, 404, "Session not found");

  let formFields = [];
  if (session.linkedEventRegId) {
    const linkedEvent = await Event.findById(session.linkedEventRegId).select("formFields").lean();
    formFields = linkedEvent?.formFields || [];
  }

  const questions = await EventQuestion.find({ sessionId: session._id })
    .populate("registrationId", "fullName company phone isoCode customFields")
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .sort({ createdAt: -1 });

  const primaryField = session.primaryField;

  const result = questions.map(q => {
    const obj = q.toObject();
    const reg = obj.registrationId;
    if (reg) {
      obj.submitterName = extractField(reg, "fullName", ["Name", "name", "FullName", "full_name"], primaryField, formFields);
      obj.submitterCompany = extractField(reg, "company", ["Company", "organization", "Organization"], null, formFields);
      obj.submitterPhone = extractField(reg, "phone", ["Phone", "phoneNumber", "mobile", "Mobile"], null, formFields);
      obj.submitterIsoCode = reg.isoCode || null;
    }
    return obj;
  });

  return response(res, 200, "Questions fetched", result);
});

// POST a new question to a session (no auth, uses registrationId)
exports.submitQuestionToSession = asyncHandler(async (req, res) => {
  const { sessionSlug } = req.params;
  const { text, registrationId } = req.body;

  if (!text) return response(res, 400, "Question text is required");

  const session = await StageQSession.findOne({ slug: sessionSlug });
  if (!session) return response(res, 404, "Session not found");

  if (session.linkedEventRegId && session.primaryField && !registrationId) {
    return response(res, 400, "Registration verification is required for this session");
  }

  const question = await EventQuestion.create({
    business: session.business,
    sessionId: session._id,
    registrationId: registrationId || null,
    text,
  });

  recomputeAndEmit(session.business || null).catch(err =>
    console.error("Background recompute failed:", err.message)
  );

  let formFields = [];
  if (session.linkedEventRegId) {
    const linkedEvent = await Event.findById(session.linkedEventRegId).select("formFields").lean();
    formFields = linkedEvent?.formFields || [];
  }

  const populated = await EventQuestion.findById(question._id)
    .populate("registrationId", "fullName company phone isoCode customFields");

  const obj = populated.toObject();
  const reg = obj.registrationId;
  if (reg) {
    obj.submitterName = extractField(reg, "fullName", ["Name", "name", "FullName", "full_name"], session.primaryField, formFields);
    obj.submitterCompany = extractField(reg, "company", ["Company", "organization", "Organization"], null, formFields);
    obj.submitterPhone = extractField(reg, "phone", ["Phone", "phoneNumber", "mobile", "Mobile"], null, formFields);
    obj.submitterIsoCode = reg.isoCode || null;
  }

  emitToRoom(roomKey(sessionSlug), "newQuestion", obj);

  return response(res, 201, "Question submitted", obj);
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

  if (question.sessionId) {
    const session = await StageQSession.findById(question.sessionId).select("slug").lean();
    if (session) {
      emitToRoom(roomKey(session.slug), "questionVoteUpdated", {
        questionId: question._id,
        votes: question.votes,
      });
    }
  }

  return response(res, 200, "Vote updated", { votes: question.votes });
});
