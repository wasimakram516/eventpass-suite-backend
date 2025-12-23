const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const WalkIn = require("../../models/WalkIn");
const SpinWheel = require("../../models/SpinWheel");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const { pickFullName } = require("../../utils/customFieldUtils");
const {
  runSpinWheelSync,
} = require("../../processors/eventwheel/spinWheelSyncProcessor");
const User = require("../../models/User");

// Add Participant (Only Admin for "admin" SpinWheels)
exports.addParticipant = asyncHandler(async (req, res) => {
  const { name, phone, company, spinWheelId } = req.body;

  if (!name || !spinWheelId)
    return response(res, 400, "Name and SpinWheel ID are required");

  const wheel = await SpinWheel.findById(spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type === "synced") {
    return response(
      res,
      403,
      "Participants for synced wheels are managed automatically"
    );
  }

  if (
    wheel.type === "admin" &&
    (!req.user || (req.user.role !== "admin" && req.user.role !== "business"))
  ) {
    return response(
      res,
      403,
      "Only admins or business users can add participants for this SpinWheel."
    );
  }

  const newParticipant = await SpinWheelParticipant.create({
    name,
    phone,
    company,
    spinWheel: spinWheelId,
  });

  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Participant added successfully", newParticipant);
});

// Add Participants in Bulk (for onspot type)
exports.addParticipantsOnSpot = asyncHandler(async (req, res) => {
  const { slug, participants } = req.body;

  if (
    !participants ||
    !Array.isArray(participants) ||
    participants.length === 0
  ) {
    return response(res, 400, "Participants array is required.");
  }

  const wheel = await SpinWheel.findOne({ slug });
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type !== "onspot") {
    return response(res, 403, "On-spot entry not allowed for this wheel");
  }
  // Clear existing participants (PERMANENT)
  await SpinWheelParticipant.deleteMany({ spinWheel: wheel._id });

  const newParticipants = participants.map((name) => ({
    name,
    spinWheel: wheel._id,
  }));

  await SpinWheelParticipant.insertMany(newParticipants);

  // Fire background recompute
  recomputeAndEmit(wheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Participants updated successfully");
});

// Sync Participants from Event Registrations (for synced type)
exports.syncSpinWheelParticipants = asyncHandler(async (req, res) => {
  const { filters = {} } = req.body;

  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return response(res, 400, "Filters must be an object.");
  }

  const wheel = await SpinWheel.findById(req.params.spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type !== "synced") {
    return response(res, 400, "SpinWheel is not of synced type");
  }

  if (!wheel.eventSource?.eventId) {
    return response(res, 400, "eventSource configuration missing");
  }

  await SpinWheel.updateOne(
    { _id: wheel._id },
    { $set: { "eventSource.filters": filters } }
  );

  response(res, 200, "SpinWheel sync started");

  setImmediate(() => {
    runSpinWheelSync(wheel._id, filters).catch(console.error);
  });
});

// Get SpinWheel Sync Filters
exports.getSpinWheelSyncFilters = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (wheel.type !== "synced") {
    return response(res, 400, "SpinWheel is not of synced type");
  }

  const eventId = wheel.eventSource?.eventId;
  if (!eventId) {
    return response(res, 400, "Event not configured for sync");
  }

  // Fetch DISTINCT scannedBy users for this event
  const scannedByUserIds = await WalkIn.distinct("scannedBy", {
    eventId,
    isDeleted: { $ne: true },
  });

  // Populate minimal user info
  const users = await User.find(
    { _id: { $in: scannedByUserIds } },
    { _id: 1, name: 1, email: 1 }
  ).lean();

  return response(res, 200, "Sync filter values retrieved", {
    scannedBy: users,
  });
});

// Get Participants by Slug
exports.getParticipantsBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const wheel = await SpinWheel.findOne({ slug }).select("_id").notDeleted();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const participants = await SpinWheelParticipant.find({ spinWheel: wheel._id })
    .notDeleted()
    .sort({ name: 1 })
    .select("name phone company");

  return response(
    res,
    200,
    "Participants retrieved successfully",
    participants
  );
});

// Get Single Participant by ID
exports.getParticipantById = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findById(
    req.params.id
  ).notDeleted();
  if (!participant) return response(res, 404, "Participant not found");

  return response(res, 200, "Participant retrieved successfully", participant);
});

// Update Participant
exports.updateParticipant = asyncHandler(async (req, res) => {
  const { name, phone, company } = req.body;
  const participant = await SpinWheelParticipant.findById(
    req.params.id
  ).populate("spinWheel", "business");

  if (!participant) return response(res, 404, "Participant not found");

  if (participant.spinWheel.type === "synced") {
    return response(res, 403, "Cannot update participants of a synced wheel");
  }

  participant.name = name || participant.name;
  participant.phone = phone || participant.phone;
  participant.company = company || participant.company;

  await participant.save();

  // Fire background recompute
  recomputeAndEmit(participant.spinwheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Participant updated successfully", participant);
});

// Soft delete participant
exports.deleteParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findById(
    req.params.id
  ).populate("spinWheel", "business type");

  if (!participant) {
    return response(res, 404, "Participant not found");
  }

  // Synced wheels → PERMANENT delete
  if (participant.spinWheel.type === "synced") {
    await participant.deleteOne();
  } else {
    // Admin / onspot → soft delete
    await participant.softDelete(req.user.id);
  }

  // Fire background recompute (correct path)
  recomputeAndEmit(participant.spinWheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    participant.spinWheel.type === "synced"
      ? "Participant deleted"
      : "Participant moved to recycle bin"
  );
});

// Restore participant
exports.restoreParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findOneDeleted({
    _id: req.params.id,
  }).populate("spinWheel", "business");
  if (!participant) return response(res, 404, "Participant not found in trash");

  await participant.restore();

  // Fire background recompute
  recomputeAndEmit(participant.spinwheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Participant restored", participant);
});

// Permanently delete participant
exports.permanentDeleteParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findOneDeleted({
    _id: req.params.id,
  }).populate("spinWheel", "business");
  if (!participant) return response(res, 404, "Participant not found in trash");

  await participant.deleteOne();
  // Fire background recompute
  recomputeAndEmit(participant.spinwheel.business || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Participant permanently deleted");
});

// Restore all participants
exports.restoreAllParticipants = asyncHandler(async (req, res) => {
  const deletedParticipants = await SpinWheelParticipant.findDeleted();

  for (const participant of deletedParticipants) {
    await participant.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedParticipants.length} participants restored.`
  );
});

// Permanently delete all participants
exports.permanentDeleteAllParticipants = asyncHandler(async (req, res) => {
  const deletedParticipants = await SpinWheelParticipant.findDeleted();

  for (const participant of deletedParticipants) {
    await participant.deleteOne();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `${deletedParticipants.length} participants permanently deleted.`
  );
});
