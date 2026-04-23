const mongoose = require("mongoose");
const Poll = require("../../models/Poll");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const PollVote = require("../../models/PollVote");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const XLSX = require("xlsx");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { getTimezoneLabel } = require("../../utils/dateUtils");

// Helper: resolve owning business for a poll
async function resolveBusinessId(poll) {
  if (poll.linkedEventRegId) {
    const linked = await Event.findById(poll.linkedEventRegId).select("businessId").lean();
    if (linked) return linked.businessId;
  }
  return poll.business;
}

// GET all polls by businessSlug
exports.getPolls = asyncHandler(async (req, res) => {
  const { businessSlug } = req.query;
  if (!businessSlug) return response(res, 400, "businessSlug is required");

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const polls = await Poll.find({ business: business._id })
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .populate("linkedEventRegId", "name slug");

  const result = polls.map(p => {
    const obj = p.toObject();
    obj.questionCount = p.questions?.length || 0;
    return obj;
  });

  return response(res, 200, "Polls fetched", result);
});

// GET poll by slug (public)
exports.getPollBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const poll = await Poll.findOne({ slug })
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  if (!poll) return response(res, 404, "Poll not found");
  return response(res, 200, "Poll fetched", poll);
});

// GET single poll by ID (public)
exports.getPublicPollById = asyncHandler(async (req, res) => {
  const { pollId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(pollId)) return response(res, 400, "Invalid poll ID");
  const poll = await Poll.findById(pollId);
  if (!poll) return response(res, 404, "Poll not found");
  return response(res, 200, "Poll fetched", poll);
});

// GET poll meta (for public vote page compatibility)
exports.getPollMeta = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return response(res, 400, "Invalid poll id");
  const poll = await Poll.findById(id).select("eventId").lean();
  if (!poll || !poll.eventId) return response(res, 404, "Poll not found");
  const event = await Event.findById(poll.eventId).withDeleted().select("slug businessId").lean();
  if (!event) return response(res, 404, "VoteCast event not found for poll");
  return response(res, 200, "Poll meta fetched", {
    eventId: poll.eventId,
    eventSlug: event.slug || null,
    businessId: event.businessId || null,
  });
});

// POST create poll
exports.createPoll = asyncHandler(async (req, res) => {
  const { title, slug, description, linkedEventRegId, businessSlug, type, primaryField, logoUrl, background } = req.body;
  const user = req.user;

  if (!title) return response(res, 400, "Title is required");

  let businessId;
  if (linkedEventRegId) {
    if (!mongoose.Types.ObjectId.isValid(linkedEventRegId)) return response(res, 400, "Invalid linkedEventRegId");
    const linkedEvent = await Event.findById(linkedEventRegId);
    if (!linkedEvent) return response(res, 404, "Linked EventReg event not found");
    businessId = linkedEvent.businessId;
  } else if (businessSlug) {
    const business = await Business.findOne({ slug: businessSlug });
    if (!business) return response(res, 404, "Business not found");
    businessId = business._id;
  } else {
    businessId = user.business?._id || user.business;
    if (!businessId) return response(res, 400, "Business could not be determined");
  }

  const pollSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await Poll.findOne({ slug: pollSlug });
  if (existing) return response(res, 400, "Slug already in use");

  if (type && !["options", "slider"].includes(type)) return response(res, 400, "Invalid poll type");

  const poll = await Poll.createWithAuditUser({
    title,
    slug: pollSlug,
    description: description || "",
    business: businessId,
    linkedEventRegId: linkedEventRegId || null,
    type: type || "options",
    primaryField: primaryField || null,
    logoUrl: logoUrl || null,
    background: background || {},
    questions: [],
  }, req.user);

  recomputeAndEmit(businessId || null).catch(err => console.error("Background recompute failed:", err.message));

  const populated = await Poll.findById(poll._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .populate("linkedEventRegId", "name slug");
  return response(res, 201, "Poll created", populated || poll);
});

// PUT update poll metadata
exports.updatePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, slug, description, type, primaryField, linkedEventRegId, logoUrl, background } = req.body;
  const user = req.user;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");

  const owningBusinessId = await resolveBusinessId(poll);
  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(owningBusinessId) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  if (title !== undefined) poll.title = title;
  if (description !== undefined) poll.description = description;
  if (type !== undefined) {
    if (!["options", "slider"].includes(type)) return response(res, 400, "Invalid poll type");
    poll.type = type;
  }
  if (primaryField !== undefined) poll.primaryField = primaryField || null;
  if (linkedEventRegId !== undefined) poll.linkedEventRegId = linkedEventRegId || null;
  if (logoUrl !== undefined) poll.logoUrl = logoUrl || null;
  if (background !== undefined) poll.background = background || {};

  if (slug !== undefined && slug !== poll.slug) {
    const existing = await Poll.findOne({ slug, _id: { $ne: id } });
    if (existing) return response(res, 400, "Slug already in use");
    poll.slug = slug;
  }

  poll.setAuditUser(req.user);
  await poll.save();

  recomputeAndEmit(owningBusinessId || null).catch(err => console.error("Background recompute failed:", err.message));

  const populated = await Poll.findById(poll._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name")
    .populate("linkedEventRegId", "name slug");
  return response(res, 200, "Poll updated", populated || poll);
});

// DELETE poll (soft)
exports.deletePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");

  const owningBusinessId = await resolveBusinessId(poll);
  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(owningBusinessId) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  await poll.softDelete(req.user.id);

  recomputeAndEmit(owningBusinessId || null).catch(err => console.error("Background recompute failed:", err.message));

  return response(res, 200, "Poll moved to recycle bin");
});

// POST clone poll
exports.clonePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existingPoll = await Poll.findById(id);
  if (!existingPoll) return response(res, 404, "Original poll not found");

  const baseSlug = existingPoll.slug + "-copy";
  let pollSlug = baseSlug;
  let counter = 1;
  while (await Poll.findOne({ slug: pollSlug })) {
    pollSlug = `${baseSlug}-${counter++}`;
  }

  const clonedPoll = new Poll({
    business: existingPoll.business,
    linkedEventRegId: existingPoll.linkedEventRegId,
    title: existingPoll.title + " (Copy)",
    slug: pollSlug,
    description: existingPoll.description,
    type: existingPoll.type,
    primaryField: existingPoll.primaryField,
    questions: existingPoll.questions.map(q => ({
      question: q.question,
      options: q.options.map(o => ({ text: o.text, imageUrl: o.imageUrl, votes: 0 })),
    })),
  });
  clonedPoll.setAuditUser(req.user);
  await clonedPoll.save();

  recomputeAndEmit(clonedPoll.business || null).catch(err => console.error("Background recompute failed:", err.message));

  const populated = await Poll.findById(clonedPoll._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 201, "Poll cloned successfully", populated || clonedPoll);
});

// --- QUESTION CRUD ---

// GET questions for a poll
exports.getPollQuestions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const poll = await Poll.findById(id)
    .select("questions type title slug")
    .populate("questions.createdBy", "name")
    .populate("questions.updatedBy", "name");
  if (!poll) return response(res, 404, "Poll not found");
  return response(res, 200, "Questions fetched", {
    questions: poll.questions,
    type: poll.type,
    title: poll.title,
    slug: poll.slug,
  });
});

// POST add question to poll
exports.addQuestion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { question, options } = req.body;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");
  if (!question) return response(res, 400, "Question text is required");

  let parsedOptions;
  try {
    parsedOptions = typeof options === "string" ? JSON.parse(options) : options;
  } catch {
    return response(res, 400, "Options must be a valid JSON array");
  }

  if (!Array.isArray(parsedOptions) || parsedOptions.length < 2) {
    return response(res, 400, "At least 2 options are required");
  }

  for (const opt of parsedOptions) {
    if (!opt.text?.trim() && !opt.imageUrl) return response(res, 400, "Each option must have text or image");
  }

  const enrichedOptions = parsedOptions.map(opt => ({
    text: opt.text?.trim() || "",
    imageUrl: opt.imageUrl || null,
    votes: 0,
  }));

  const now = new Date();
  const userId = req.user?.id || req.user?._id || null;
  poll.questions.push({
    question,
    options: enrichedOptions,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  poll.setAuditUser(req.user);
  await poll.save();

  const populated = await Poll.findById(poll._id)
    .populate("questions.createdBy", "name")
    .populate("questions.updatedBy", "name")
    .select("questions");
  const newQuestion = populated.questions[populated.questions.length - 1];
  return response(res, 201, "Question added", newQuestion);
});

// PUT update question in poll
exports.updateQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;
  const { question, options } = req.body;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");

  const q = poll.questions.id(questionId);
  if (!q) return response(res, 404, "Question not found");

  if (question !== undefined) q.question = question;

  if (options !== undefined) {
    let parsedOptions;
    try {
      parsedOptions = typeof options === "string" ? JSON.parse(options) : options;
    } catch {
      return response(res, 400, "Options must be a valid JSON array");
    }
    if (!Array.isArray(parsedOptions) || parsedOptions.length < 2) {
      return response(res, 400, "At least 2 options are required");
    }

    const newOptions = await Promise.all(parsedOptions.map(async (opt, idx) => {
      const existingOpt = q.options[idx];
      const imageUrl = opt.imageUrl || null;
      if (!imageUrl && existingOpt?.imageUrl) {
        try { await deleteFromS3(existingOpt.imageUrl); } catch {}
      }
      return {
        text: opt.text?.trim() || "",
        imageUrl,
        votes: typeof opt.votes === "number" ? opt.votes : (existingOpt?.votes || 0),
      };
    }));
    q.options = newOptions;
  }

  q.updatedBy = req.user?.id || req.user?._id || null;
  q.updatedAt = new Date();
  poll.setAuditUser(req.user);
  await poll.save();

  const populatedPoll = await Poll.findById(poll._id)
    .populate("questions.createdBy", "name")
    .populate("questions.updatedBy", "name")
    .select("questions");
  const updatedQuestion = populatedPoll.questions.id(questionId);
  return response(res, 200, "Question updated", updatedQuestion);
});

// DELETE question from poll
exports.deleteQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");

  const q = poll.questions.id(questionId);
  if (!q) return response(res, 404, "Question not found");

  for (const opt of q.options || []) {
    if (opt.imageUrl) { try { await deleteFromS3(opt.imageUrl); } catch {} }
  }

  q.deleteOne();
  poll.setAuditUser(req.user);
  await poll.save();
  return response(res, 200, "Question deleted");
});

// POST clone question in poll
exports.cloneQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");

  const original = poll.questions.id(questionId);
  if (!original) return response(res, 404, "Question not found");

  const now = new Date();
  const userId = req.user?.id || req.user?._id || null;
  const cloned = {
    question: original.question + " (Copy)",
    options: (original.options || []).map((o) => ({
      text: o.text || "",
      imageUrl: o.imageUrl || null,
      votes: 0,
    })),
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  poll.questions.push(cloned);
  poll.setAuditUser(req.user);
  await poll.save();

  const populatedPoll = await Poll.findById(poll._id)
    .populate("questions.createdBy", "name")
    .populate("questions.updatedBy", "name")
    .select("questions");
  const newQuestion = populatedPoll.questions[populatedPoll.questions.length - 1];
  return response(res, 201, "Question cloned", newQuestion);
});

// --- VOTING ---

// POST vote on a question within a poll
exports.voteOnPoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { questionId, optionIndex, registrationId } = req.body;

  const poll = await Poll.findById(id);
  if (!poll) return response(res, 404, "Poll not found");

  const question = poll.questions.id(questionId);
  if (!question) return response(res, 404, "Question not found");

  if (typeof optionIndex !== "number" || optionIndex < 0 || optionIndex >= question.options.length) {
    return response(res, 400, "Invalid option index");
  }

  if (poll.linkedEventRegId) {
    if (!registrationId || !mongoose.Types.ObjectId.isValid(registrationId)) {
      return response(res, 400, "registrationId is required for this poll");
    }
    const existing = await PollVote.findOne({ pollId: id, questionId, registrationId });
    if (existing) return response(res, 409, "You have already voted on this question");
    await PollVote.create({ pollId: poll._id, questionId, registrationId, optionIndex });
  }

  question.options[optionIndex].votes += 1;
  await poll.save();
  return response(res, 200, "Vote submitted");
});

// POST verify attendee by poll ID
exports.verifyAttendeeByPoll = asyncHandler(async (req, res) => {
  const { pollId, fieldValue } = req.body;
  if (!pollId || !fieldValue) return response(res, 400, "pollId and fieldValue are required");

  const poll = await Poll.findById(pollId).select("linkedEventRegId primaryField").lean();
  if (!poll) return response(res, 404, "Poll not found");

  if (!poll.linkedEventRegId || !poll.primaryField) {
    return response(res, 400, "This poll does not require identity verification");
  }

  const primaryField = poll.primaryField;
  const linkedEvent = await Event.findById(poll.linkedEventRegId).select("formFields").lean();
  if (!linkedEvent) return response(res, 404, "Linked EventReg event not found");

  const isCustomField = linkedEvent.formFields?.some(f => f.inputName === primaryField);
  const safeValue = fieldValue.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const caseInsensitive = { $regex: new RegExp(`^${safeValue}$`, 'i') };
  const query = { eventId: poll.linkedEventRegId, deletedAt: { $exists: false } };
  if (isCustomField) {
    query[`customFields.${primaryField}`] = caseInsensitive;
  } else {
    query[primaryField] = caseInsensitive;
  }

  const registration = await Registration.findOne(query).select("_id fullName customFields").lean();
  if (!registration) return response(res, 404, "No matching registration found");

  let displayName = registration.fullName || null;
  if (!displayName && registration.customFields) {
    const nameKeys = ["Name", "name", "fullName", "FullName", "full_name"];
    for (const key of nameKeys) {
      if (registration.customFields[key]) {
        displayName = registration.customFields[key];
        break;
      }
    }
  }

  return response(res, 200, "Attendee verified", {
    registrationId: registration._id,
    fullName: displayName,
  });
});

// POST verify attendee against VoteCast event (legacy)
exports.verifyAttendee = asyncHandler(async (req, res) => {
  const { eventSlug, fieldValue } = req.body;
  if (!eventSlug || !fieldValue) return response(res, 400, "eventSlug and fieldValue are required");

  const votecastEvent = await Event.findOne({ slug: eventSlug, eventType: "votecast" })
    .select("linkedEventRegId primaryField").lean();
  if (!votecastEvent) return response(res, 404, "VoteCast event not found");

  if (!votecastEvent.linkedEventRegId || !votecastEvent.primaryField) {
    return response(res, 400, "This event does not require identity verification");
  }

  const primaryField = votecastEvent.primaryField;
  const linkedEvent = await Event.findById(votecastEvent.linkedEventRegId).select("formFields").lean();
  if (!linkedEvent) return response(res, 404, "Linked EventReg event not found");

  const isCustomField = linkedEvent.formFields?.some(f => f.inputName === primaryField);
  const query = { eventId: votecastEvent.linkedEventRegId, deletedAt: { $exists: false } };
  if (isCustomField) {
    query[`customFields.${primaryField}`] = fieldValue;
  } else {
    query[primaryField] = fieldValue;
  }

  const registration = await Registration.findOne(query).select("_id fullName").lean();
  if (!registration) return response(res, 404, "No matching registration found");

  return response(res, 200, "Attendee verified", {
    registrationId: registration._id,
    fullName: registration.fullName,
  });
});

// GET results for a single poll (CMS)
exports.getPollResults = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const poll = await Poll.findById(id).lean();
  if (!poll) return response(res, 404, "Poll not found");

  const results = (poll.questions || []).map((q) => {
    const totalVotes = (q.options || []).reduce((sum, o) => sum + (o.votes || 0), 0);
    return {
      _id: q._id,
      question: q.question,
      options: (q.options || []).map((o) => ({
        text: o.text || "",
        votes: o.votes || 0,
        percentage: totalVotes > 0 ? parseFloat(((o.votes || 0) / totalVotes * 100).toFixed(2)) : 0,
        imageUrl: o.imageUrl || null,
      })),
    };
  });

  return response(res, 200, "Results fetched", results);
});

// GET export questions for a poll as XLSX
exports.exportQuestions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { timezone } = req.query;
  const poll = await Poll.findById(id).lean();
  if (!poll) return res.status(404).json({ message: "Poll not found" });

  const questions = poll.questions || [];

  // Find max number of options across all questions
  const maxOptions = questions.reduce((max, q) => Math.max(max, (q.options || []).length), 0);

  const wb = XLSX.utils.book_new();

  // Metadata rows at the top
  const metaRows = [
    ["Timezone", timezone ? getTimezoneLabel(timezone) : "UTC"],
    [],
  ];
  const metaOffset = metaRows.length;

  // Row 1: "Question" + "Option N" headers (each spanning 3 cols: Text, Votes, %)
  const row1 = ["Question"];
  for (let i = 1; i <= maxOptions; i++) {
    row1.push(`Option ${i}`, "", "");
  }

  // Row 2: "" + "Text", "Votes", "%" repeated per option
  const row2 = [""];
  for (let i = 0; i < maxOptions; i++) {
    row2.push("Text", "Votes", "%");
  }

  // Data rows
  const dataRows = questions.map((q) => {
    const totalVotes = (q.options || []).reduce((sum, o) => sum + (o.votes || 0), 0);
    const row = [q.question || ""];
    for (let i = 0; i < maxOptions; i++) {
      const opt = (q.options || [])[i];
      if (opt) {
        const pct = totalVotes > 0 ? ((opt.votes || 0) / totalVotes * 100).toFixed(2) : "0.00";
        row.push(opt.text || "", opt.votes || 0, pct);
      } else {
        row.push("", "", "");
      }
    }
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([...metaRows, row1, row2, ...dataRows]);

  // Merge "Option N" cells across 3 columns each (offset by metaRows length)
  ws["!merges"] = [];
  for (let i = 0; i < maxOptions; i++) {
    const startCol = 1 + i * 3;
    ws["!merges"].push({ s: { r: metaOffset, c: startCol }, e: { r: metaOffset, c: startCol + 2 } });
  }

  // Column widths: Question col wide, then 3 cols per option
  ws["!cols"] = [{ wch: 40 }];
  for (let i = 0; i < maxOptions; i++) {
    ws["!cols"].push({ wch: 25 }, { wch: 8 }, { wch: 8 });
  }

  XLSX.utils.book_append_sheet(wb, ws, "Questions");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  const filename = `${poll.slug || poll._id}_questions.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

// GET active polls for a VoteCast event (legacy public)
exports.getActivePollsByEvent = asyncHandler(async (req, res) => {
  const { eventSlug } = req.params;
  const event = await Event.findOne({ slug: eventSlug, eventType: "votecast" });
  if (!event) return response(res, 404, "VoteCast event not found");
  const polls = await Poll.find({ eventId: event._id });
  return response(res, 200, "Polls fetched", polls);
});

// Soft-delete restore/permanent operations (kept for recycle bin)
exports.restorePoll = asyncHandler(async (req, res) => {
  const poll = await Poll.findOneDeleted({ _id: req.params.id });
  if (!poll) return response(res, 404, "Poll not found in trash");
  await poll.restore();
  recomputeAndEmit(poll.business || null).catch(err => console.error("Background recompute failed:", err.message));
  return response(res, 200, "Poll restored", poll);
});

exports.permanentDeletePoll = asyncHandler(async (req, res) => {
  const poll = await Poll.findOneDeleted({ _id: req.params.id });
  if (!poll) return response(res, 404, "Poll not found in trash");
  for (const q of poll.questions || []) {
    for (const option of q.options || []) {
      if (option.imageUrl) { try { await deleteFromS3(option.imageUrl); } catch {} }
    }
  }
  await poll.deleteOne();
  recomputeAndEmit(poll.business || null).catch(err => console.error("Background recompute failed:", err.message));
  return response(res, 200, "Poll permanently deleted");
});

exports.restoreAllPolls = asyncHandler(async (req, res) => {
  const polls = await Poll.findDeleted();
  if (!polls.length) return response(res, 404, "No polls found in trash to restore");
  for (const poll of polls) await poll.restore();
  recomputeAndEmit(null).catch(err => console.error("Background recompute failed:", err.message));
  return response(res, 200, `Restored ${polls.length} polls`);
});

exports.permanentDeleteAllPolls = asyncHandler(async (req, res) => {
  const polls = await Poll.findDeleted();
  if (!polls.length) return response(res, 404, "No polls found in trash to delete");
  for (const poll of polls) {
    for (const q of poll.questions || []) {
      for (const option of q.options || []) {
        if (option.imageUrl) { try { await deleteFromS3(option.imageUrl); } catch {} }
      }
    }
    await poll.deleteOne();
  }
  recomputeAndEmit(null).catch(err => console.error("Background recompute failed:", err.message));
  return response(res, 200, `Permanently deleted ${polls.length} polls`);
});

exports.resetVotes = asyncHandler(async (req, res) => {
  const { pollId } = req.body;
  if (!pollId || !mongoose.Types.ObjectId.isValid(pollId)) return response(res, 400, "Valid pollId is required");
  const poll = await Poll.findById(pollId);
  if (!poll) return response(res, 404, "Poll not found");
  for (const q of poll.questions) {
    for (const opt of q.options) opt.votes = 0;
  }
  await poll.save();
  await PollVote.deleteMany({ pollId: poll._id });
  return response(res, 200, "Votes reset successfully");
});
