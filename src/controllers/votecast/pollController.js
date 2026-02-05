const mongoose = require("mongoose");
const Poll = require("../../models/Poll");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const XLSX = require("xlsx");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { uploadToS3, deleteFromS3 } = require("../../utils/s3Storage");

// GET polls
exports.getPolls = asyncHandler(async (req, res) => {
  const { eventId } = req.query;

  const filter = {};
  if (eventId) {
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return response(res, 400, "Invalid event ID");
    }
    const event = await Event.findById(eventId).notDeleted();
    if (!event || event.eventType !== "votecast") {
      return response(res, 404, "VoteCast event not found");
    }
    filter.eventId = event._id;
    filter.business = event.businessId;
  } else {
    return response(res, 400, "eventId is required");
  }

  const polls = await Poll.find(filter)
    .notDeleted()
    .populate("eventId", "name slug")
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 200, "Polls fetched", polls);
});

// POST create poll
exports.createPoll = asyncHandler(async (req, res) => {
  const { question, options, eventId, type } = req.body;
  const user = req.user;

  if (!question || !options) {
    return response(res, 400, "Question and options are required");
  }

  if (!eventId) {
    return response(res, 400, "eventId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return response(res, 400, "Invalid event ID");
  }

  const event = await Event.findById(eventId).notDeleted();
  if (!event || event.eventType !== "votecast") {
    return response(res, 404, "VoteCast event not found");
  }

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(event.businessId) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) {
    return response(res, 403, "Permission denied");
  }

  let parsedOptions;
  try {
    parsedOptions = JSON.parse(options);
  } catch {
    return response(res, 400, "Options must be a valid JSON array");
  }

  if (!Array.isArray(parsedOptions) || parsedOptions.length < 2) {
    return response(res, 400, "At least 2 options are required");
  }

  if (type && !["options", "slider"].includes(type)) {
    return response(res, 400, "Invalid poll type");
  }

  // Validate that each option has either text or imageUrl
  for (const opt of parsedOptions) {
    const hasText = opt.text && opt.text.trim() !== "";
    const hasImage = opt.imageUrl && opt.imageUrl.trim() !== "";
    if (!hasText && !hasImage) {
      return response(res, 400, "Each option must have either text or image");
    }
  }

  const enrichedOptions = parsedOptions.map((opt) => {
    const text = opt.text && opt.text.trim() !== "" ? opt.text.trim() : null;
    const imageUrl = opt.imageUrl && opt.imageUrl.trim() !== "" ? opt.imageUrl : null;

    return {
      text: text || "",
      imageUrl: imageUrl,
      votes: 0,
    };
  });

  const poll = await Poll.createWithAuditUser(
    {
      question,
      options: enrichedOptions,
      business: event.businessId,
      eventId: event._id,
      type: type || "options",
    },
    req.user
  );

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Poll.findById(poll._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 201, "Poll created", populated || poll);
});

// PATCH update poll
exports.updatePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { question, options, type } = req.body;
  const user = req.user;

  const poll = await Poll.findById(id).populate("eventId");
  if (!poll) return response(res, 404, "Poll not found");

  const pollEvent = await Event.findById(poll.eventId).notDeleted();
  if (!pollEvent || pollEvent.eventType !== "votecast") {
    return response(res, 404, "VoteCast event not found");
  }

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(pollEvent.businessId) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  if (question !== undefined) poll.question = question;

  if (type !== undefined) {
    if (!["options", "slider"].includes(type)) {
      return response(res, 400, "Invalid poll type");
    }
    poll.type = type;
  }

  if (options !== undefined) {
    let parsedOptions;
    try {
      parsedOptions = JSON.parse(options);
    } catch {
      return response(res, 400, "Options must be a valid JSON array");
    }

    if (!Array.isArray(parsedOptions) || parsedOptions.length < 2) {
      return response(res, 400, "At least 2 options are required");
    }

    // Validate that each option has either text or imageUrl
    for (const opt of parsedOptions) {
      const hasText = opt.text && opt.text.trim() !== "";
      const hasImage = opt.imageUrl && opt.imageUrl.trim() !== "";
      if (!hasText && !hasImage) {
        return response(res, 400, "Each option must have either text or image");
      }
    }

    poll.options = await Promise.all(
      parsedOptions.map(async (opt, idx) => {
        const existingOption = poll.options[idx];

        const text = opt.text && opt.text.trim() !== "" ? opt.text.trim() : null;
        let imageUrl = opt.imageUrl && opt.imageUrl.trim() !== "" ? opt.imageUrl : null;

        if (!imageUrl && existingOption?.imageUrl) {
          try {
            await deleteFromS3(existingOption.imageUrl);
          } catch (err) {
            console.error("Failed to delete old image from S3:", err);
          }
        }

        else if (imageUrl && existingOption?.imageUrl && imageUrl !== existingOption.imageUrl) {
          try {
            await deleteFromS3(existingOption.imageUrl);
          } catch (err) {
            console.error("Failed to delete old image from S3:", err);
          }
        }

        return {
          text: text || "",
          imageUrl: imageUrl,
          votes: typeof opt.votes === "number" ? opt.votes : (existingOption?.votes || 0),
        };
      })
    );
  }

  poll.setAuditUser(req.user);
  await poll.save();

  // Fire background recompute
  recomputeAndEmit(pollEvent.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Poll.findById(poll._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 200, "Poll updated", populated || poll);
});

// Soft delete poll
exports.deletePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const poll = await Poll.findById(id).populate("eventId");
  if (!poll) return response(res, 404, "Poll not found");

  const pollEvent = await Event.findById(poll.eventId).notDeleted();
  if (!pollEvent || pollEvent.eventType !== "votecast") {
    return response(res, 404, "VoteCast event not found");
  }

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(pollEvent.businessId) === String(user.business?._id || user.business);
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  await poll.softDelete(req.user.id);

  // Fire background recompute
  recomputeAndEmit(pollEvent.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Poll moved to recycle bin");
});

// Restore poll
exports.restorePoll = asyncHandler(async (req, res) => {
  const poll = await Poll.findOneDeleted({ _id: req.params.id });
  if (!poll) return response(res, 404, "Poll not found in trash");

  await poll.restore();

  // Fire background recompute
  recomputeAndEmit(poll.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Poll restored", poll);
});

// Permanently delete poll
exports.permanentDeletePoll = asyncHandler(async (req, res) => {
  const poll = await Poll.findOneDeleted({ _id: req.params.id });
  if (!poll) return response(res, 404, "Poll not found in trash");

  for (const option of poll.options || []) {
    if (option.imageUrl) {
      await deleteFromS3(option.imageUrl);
    }
  }

  await poll.deleteOne();

  // Fire background recompute
  recomputeAndEmit(poll.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Poll permanently deleted");
});

// Restore all polls
exports.restoreAllPolls = asyncHandler(async (req, res) => {
  const polls = await Poll.findDeleted();
  if (!polls.length) {
    return response(res, 404, "No polls found in trash to restore");
  }

  for (const poll of polls) {
    await poll.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${polls.length} polls`);
});

// Permanently delete all polls
exports.permanentDeleteAllPolls = asyncHandler(async (req, res) => {
  const polls = await Poll.findDeleted();
  if (!polls.length) {
    return response(res, 404, "No polls found in trash to delete");
  }

  for (const poll of polls) {
    for (const option of poll.options || []) {
      if (option.imageUrl) {
        await deleteFromS3(option.imageUrl);
      }
    }
    await poll.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Permanently deleted ${polls.length} polls`);
});

// POST clone poll
exports.clonePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existingPoll = await Poll.findById(id);
  if (!existingPoll) return response(res, 404, "Original poll not found");

  const clonedPoll = new Poll({
    business: existingPoll.business,
    eventId: existingPoll.eventId,
    question: existingPoll.question + " (Copy)",
    options: existingPoll.options.map((opt) => ({
      text: opt.text,
      imageUrl: opt.imageUrl,
    })),
    type: existingPoll.type,
  });
  clonedPoll.setAuditUser(req.user);
  await clonedPoll.save();

  // Fire background recompute
  recomputeAndEmit(clonedPoll.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Poll.findById(clonedPoll._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 201, "Poll cloned successfully", populated || clonedPoll);
});

// POST vote
exports.voteOnPoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { optionIndex } = req.body;

  const poll = await Poll.findById(id).notDeleted();
  if (!poll) return response(res, 404, "Poll not found");

  if (
    typeof optionIndex !== "number" ||
    optionIndex < 0 ||
    optionIndex >= poll.options.length
  ) {
    return response(res, 400, "Invalid option index");
  }

  poll.options[optionIndex].votes += 1;
  await poll.save();

  return response(res, 200, "Vote submitted");
});

// POST reset votes
exports.resetVotes = asyncHandler(async (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return response(res, 400, "eventId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return response(res, 400, "Invalid event ID");
  }

  const event = await Event.findById(eventId).notDeleted();
  if (!event || event.eventType !== "votecast") {
    return response(res, 404, "VoteCast event not found");
  }

  const filter = { eventId: event._id };

  const polls = await Poll.find(filter).notDeleted();
  if (polls.length === 0) return response(res, 404, "No polls found");

  await Promise.all(
    polls.map(async (poll) => {
      poll.options.forEach((opt) => (opt.votes = 0));
      await poll.save();
    })
  );

  return response(res, 200, "Votes reset successfully");
});

// Active Polls by event
exports.getActivePollsByEvent = asyncHandler(async (req, res) => {
  const { eventSlug } = req.params;

  const event = await Event.findOne({ slug: eventSlug, eventType: "votecast" }).notDeleted();
  if (!event) return response(res, 404, "VoteCast event not found");

  const polls = await Poll.find({
    eventId: event._id,
  }).notDeleted();

  return response(res, 200, "Polls fetched", polls);
});

// Poll Results
exports.getPollResults = asyncHandler(async (req, res) => {
  const { eventId } = req.query;

  if (!eventId) return response(res, 400, "eventId is required");

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return response(res, 400, "Invalid event ID");
  }

  const event = await Event.findById(eventId).notDeleted();
  if (!event || event.eventType !== "votecast") {
    return response(res, 404, "VoteCast event not found");
  }

  const filter = { eventId: event._id };

  const polls = await Poll.find(filter).notDeleted();

  const resultData = polls.map((poll) => {
    const totalVotes =
      poll.options.reduce((sum, opt) => sum + opt.votes, 0) || 1;

    const options = poll.options.map((opt) => ({
      text: opt.text,
      imageUrl: opt.imageUrl,
      votes: opt.votes,
      percentage: parseFloat(((opt.votes / totalVotes) * 100).toFixed(2)),
    }));

    return {
      _id: poll._id,
      question: poll.question,
      totalVotes:
        totalVotes === 1 && poll.options.every((opt) => opt.votes === 0)
          ? 0
          : totalVotes,
      options,
    };
  });

  return response(res, 200, "Results fetched", resultData);
});

// POST export polls
exports.exportPollsToExcel = asyncHandler(async (req, res) => {
  const { eventId } = req.body;

  if (!eventId) {
    return response(res, 400, "eventId is required");
  }

  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return response(res, 400, "Invalid event ID");
  }

  const event = await Event.findById(eventId).notDeleted();
  if (!event || event.eventType !== "votecast") {
    return response(res, 404, "VoteCast event not found");
  }

  const filter = { eventId: event._id };

  const polls = await Poll.find(filter).notDeleted();
  if (polls.length === 0) return response(res, 404, "No polls found");

  const maxOptions = Math.max(...polls.map((p) => p.options.length));

  const headerRow1 = ["Event", "Question"];
  const headerRow2 = ["", ""];

  for (let i = 1; i <= maxOptions; i++) {
    headerRow1.push(`Option ${i}`, "", "");
    headerRow2.push("Text", "Votes", "%");
  }
  headerRow1.push("Total Votes");
  headerRow2.push("");

  const wsData = [headerRow1, headerRow2];

  polls.forEach((poll) => {
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    const row = [event.name, poll.question];

    poll.options.forEach((option) => {
      const percent = totalVotes
        ? ((option.votes / totalVotes) * 100).toFixed(2)
        : "0.00";
      row.push(option.text, option.votes, percent);
    });

    for (let i = poll.options.length; i < maxOptions; i++) {
      row.push("", "", "");
    }

    row.push(totalVotes);
    wsData.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  for (let i = 1; i <= maxOptions; i++) {
    const startCol = 3 + (i - 1) * 3;
    const endCol = startCol + 2;
    ws["!merges"] = ws["!merges"] || [];
    ws["!merges"].push({ s: { r: 0, c: startCol }, e: { r: 0, c: endCol } });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Poll Results");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${event.slug}-polls.xlsx"`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  return res.status(200).send(buffer);
});
