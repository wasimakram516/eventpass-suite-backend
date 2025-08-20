const SpinWheelParticipant = require("../../models/SpinWheelParticipant");
const SpinWheel = require("../../models/SpinWheel");
const response = require("../../utils/response");
const asyncHandler = require("../../middlewares/asyncHandler");

// Add Participant (Only Admin for "collect_info" SpinWheels)
const addParticipant = asyncHandler(async (req, res) => {
  const { name, phone, company, spinWheelId } = req.body;

  if (!name || !spinWheelId) return response(res, 400, "Name and SpinWheel ID are required");

  const wheel = await SpinWheel.findById(spinWheelId);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  if (
  wheel.type === "collect_info" &&
  (!req.user || (req.user.role !== "admin" && req.user.role !== "business"))
) {
  return response(res, 403, "Only admins or business users can add participants for this SpinWheel.");
}

  const newParticipant = await SpinWheelParticipant.create({
    name,
    phone,
    company,
    spinWheel: spinWheelId,
  });

  return response(res, 201, "Participant added successfully", newParticipant);
});

// Add or Update Participants in Bulk
const addOrUpdateParticipantsInBulk = asyncHandler(async (req, res) => {
  const { slug, participants } = req.body;

  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return response(res, 400, "Participants array is required.");
  }

  const wheel = await SpinWheel.findOne({ slug });
  if (!wheel) return response(res, 404, "SpinWheel not found");

  await SpinWheelParticipant.deleteMany({ spinWheel: wheel._id });

  const newParticipants = participants.map((name) => ({
    name,
    spinWheel: wheel._id,
  }));

  await SpinWheelParticipant.insertMany(newParticipants);

  return response(res, 201, "Participants updated successfully");
});

// Get Existing Participants by Slug
const getBulkParticipantsForSpinWheel = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const wheel = await SpinWheel.findOne({ slug }).select("_id").notDeleted();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const participants = await SpinWheelParticipant.find({ spinWheel: wheel._id })
    .notDeleted()
    .sort({ name: 1 })
    .select("name");

  return response(res, 200, "Participants retrieved successfully", participants);
});

// Get All Participants for a SpinWheel (by ID)
const getParticipants = asyncHandler(async (req, res) => {
  const spinWheelId = req.params.spinWheelId;
  const participants = await SpinWheelParticipant.find({ spinWheel: spinWheelId }).notDeleted().sort({ name: 1 });

  return response(res, 200, "Participants retrieved successfully", participants);
});

// Get Participants by Slug
const getParticipantsBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const wheel = await SpinWheel.findOne({ slug }).select("_id").notDeleted();
  if (!wheel) return response(res, 404, "SpinWheel not found");

  const participants = await SpinWheelParticipant.find({ spinWheel: wheel._id }).notDeleted()
    .sort({ name: 1 })
    .select("name phone company");

  return response(res, 200, "Participants retrieved successfully", participants);
});

// Get Single Participant by ID
const getParticipantById = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findById(req.params.id).notDeleted();
  if (!participant) return response(res, 404, "Participant not found");

  return response(res, 200, "Participant retrieved successfully", participant);
});

// Update Participant
const updateParticipant = asyncHandler(async (req, res) => {
  const { name, phone, company } = req.body;
  const participant = await SpinWheelParticipant.findById(req.params.id);

  if (!participant) return response(res, 404, "Participant not found");

  participant.name = name || participant.name;
  participant.phone = phone || participant.phone;
  participant.company = company || participant.company;

  await participant.save();

  return response(res, 200, "Participant updated successfully", participant);
});

// Soft delete participant
const deleteParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findById(req.params.id);
  if (!participant) return response(res, 404, "Participant not found");

  await participant.softDelete(req.user.id);
  return response(res, 200, "Participant moved to recycle bin");
});

// Restore participant
const restoreParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findOneDeleted({ _id: req.params.id });
  if (!participant) return response(res, 404, "Participant not found in trash");

  await participant.restore();
  return response(res, 200, "Participant restored", participant);
});

// Permanently delete participant
const permanentDeleteParticipant = asyncHandler(async (req, res) => {
  const participant = await SpinWheelParticipant.findOneDeleted({ _id: req.params.id });
  if (!participant) return response(res, 404, "Participant not found in trash");

  await participant.deleteOne();
  return response(res, 200, "Participant permanently deleted");
});

// Public API to Get SpinWheel Details
const getPublicSpinWheel = asyncHandler(async (req, res) => {
  const wheel = await SpinWheel.findById(req.params.id);
  if (!wheel) return response(res, 404, "SpinWheel not found");

  return response(res, 200, "SpinWheel details retrieved", wheel);
});

module.exports = {
  addParticipant,
  addOrUpdateParticipantsInBulk,
  getBulkParticipantsForSpinWheel,
  getParticipants,
  getParticipantsBySlug,
  getParticipantById,
  updateParticipant,
  deleteParticipant,
  restoreParticipant,
  permanentDeleteParticipant,
  getPublicSpinWheel,
};
