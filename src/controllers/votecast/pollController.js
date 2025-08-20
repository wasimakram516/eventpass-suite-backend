const Poll = require("../../models/Poll");
const Business = require("../../models/Business");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const XLSX = require("xlsx");

// GET polls
exports.getPolls = asyncHandler(async (req, res) => {
  const { businessSlug, status } = req.query;
  const user = req.user;

  const filter = {};
  if (status) filter.status = status;

  if (businessSlug) {
    const business = await Business.findOne({ slug: businessSlug }).notDeleted();
    if (!business) return response(res, 404, "Business not found");
    filter.business = business._id;
  } else if (user.role === "business") {
    const businesses = await Business.find({ owner: user.id }).notDeleted();
    filter.business = { $in: businesses.map((b) => b._id) };
  }

  const polls = await Poll.find(filter).notDeleted().populate("business", "name slug");
  return response(res, 200, "Polls fetched", polls);
});

// POST create poll
exports.createPoll = asyncHandler(async (req, res) => {
  const { question, options, businessId, status, type } = req.body;
  const user = req.user;

  if (!question || !options) {
    return response(res, 400, "Question and options are required");
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

  let business;
  if (user.role === "business") {
    business = await Business.findOne({ owner: user.id });
    if (!business)
      return response(res, 403, "You don’t have a business account");
  } else {
    business = await Business.findById(businessId);
    if (!business) return response(res, 404, "Business not found");
  }

  const files = req.files || [];

  const enrichedOptions = await Promise.all(
    parsedOptions.map(async (opt, idx) => {
      if (!opt.text) throw new Error("Each option must have text");

      let imageUrl = "";
      if (files[idx]) {
        const uploaded = await uploadToCloudinary(
          files[idx].buffer,
          files[idx].mimetype
        );
        imageUrl = uploaded.secure_url;
      }

      return {
        text: opt.text,
        imageUrl,
        votes: 0,
      };
    })
  );

  const poll = await Poll.create({
    question,
    options: enrichedOptions,
    business: business._id,
    status: status || "active",
    type: type || "options",
  });

  return response(res, 201, "Poll created", poll);
});

// PATCH update poll
exports.updatePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { question, options, status, type } = req.body;
  const user = req.user;

  const poll = await Poll.findById(id).populate("business");
  if (!poll) return response(res, 404, "Poll not found");

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(poll.business.owner) === user.id;
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  if (question !== undefined) poll.question = question;
  if (status !== undefined) poll.status = status;

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

    const files = req.files || [];

    poll.options = await Promise.all(
      parsedOptions.map(async (opt, idx) => {
        let imageUrl = opt.imageUrl || "";

        if (files[idx]) {
          const uploaded = await uploadToCloudinary(
            files[idx].buffer,
            files[idx].mimetype
          );
          imageUrl = uploaded.secure_url;
        }

        return {
          text: opt.text,
          imageUrl,
          votes: typeof opt.votes === "number" ? opt.votes : 0,
        };
      })
    );
  }

  await poll.save();
  return response(res, 200, "Poll updated", poll);
});

// Soft delete poll
exports.deletePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  const poll = await Poll.findById(id).populate("business");
  if (!poll) return response(res, 404, "Poll not found");

  const isAdmin = ["admin", "superadmin"].includes(user.role);
  const isOwner = String(poll.business.owner) === user.id;
  if (!isAdmin && !isOwner) return response(res, 403, "Permission denied");

  await poll.softDelete(req.user.id);
  return response(res, 200, "Poll moved to recycle bin");
});

// Restore poll
exports.restorePoll = asyncHandler(async (req, res) => {
  const poll = await Poll.findOneDeleted({ _id: req.params.id });
  if (!poll) return response(res, 404, "Poll not found in trash");

  await poll.restore();
  return response(res, 200, "Poll restored", poll);
});

// Permanently delete poll
exports.permanentDeletePoll = asyncHandler(async (req, res) => {
  const poll = await Poll.findOneDeleted({ _id: req.params.id });
  if (!poll) return response(res, 404, "Poll not found in trash");

  await poll.deleteOne();
  return response(res, 200, "Poll permanently deleted");
});

// POST clone poll
exports.clonePoll = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existingPoll = await Poll.findById(id);
  if (!existingPoll) return response(res, 404, "Original poll not found");

  const clonedPoll = new Poll({
    business: existingPoll.business,
    question: existingPoll.question + " (Copy)",
    options: existingPoll.options.map((opt) => ({
      text: opt.text,
      imageUrl: opt.imageUrl,
    })),
    status: existingPoll.status,
    type: existingPoll.type,
  });

  await clonedPoll.save();
  return response(res, 201, "Poll cloned successfully", clonedPoll);
});

// POST vote
exports.voteOnPoll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { optionIndex } = req.body;

  const poll = await Poll.findById(id).notDeleted();
  if (!poll) return response(res, 404, "Poll not found");
  if (poll.status !== "active") return response(res, 403, "Poll is not active");

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
  const { businessSlug, status } = req.body;

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

  const filter = { business: business._id };
  if (status) filter.status = status;

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

// Active Polls by business
exports.getActivePollsByBusiness = asyncHandler(async (req, res) => {
  const { businessSlug } = req.params;

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const polls = await Poll.find({
    business: business._id,
    status: "active",
  }).notDeleted();

  return response(res, 200, "Active polls fetched", polls);
});

// Poll Results
exports.getPollResults = asyncHandler(async (req, res) => {
  const { businessSlug, status } = req.query; // e.g., ?businessSlug=oabc&status=active

  if (!businessSlug) return response(res, 400, "businessSlug is required");

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const filter = { business: business._id };
  if (status) filter.status = status;

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
  const { businessSlug, status } = req.body;

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) return response(res, 404, "Business not found");

  const filter = { business: business._id };
  if (status) filter.status = status;

  const polls = await Poll.find(filter).notDeleted();
  if (polls.length === 0) return response(res, 404, "No polls found");

  const maxOptions = Math.max(...polls.map((p) => p.options.length));

  const headerRow1 = ["Business", "Status", "Question"];
  const headerRow2 = ["", "", ""];

  for (let i = 1; i <= maxOptions; i++) {
    headerRow1.push(`Option ${i}`, "", "");
    headerRow2.push("Text", "Votes", "%");
  }
  headerRow1.push("Total Votes");
  headerRow2.push("");

  const wsData = [headerRow1, headerRow2];

  polls.forEach((poll) => {
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    const row = [business.slug, poll.status, poll.question];

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
    `attachment; filename="${business.slug}-polls.xlsx"`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  return res.status(200).send(buffer);
});
