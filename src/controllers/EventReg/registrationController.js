const mongoose = require("mongoose");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");

// CREATE public registration
exports.createRegistration = asyncHandler(async (req, res) => {
  const { slug, fullName, email, phone, company } = req.body;

  if (!slug) return response(res, 400, "Event slug is required");

  const event = await Event.findOne({ slug });
  if (!event) return response(res, 404, "Event not found");

  if (event.eventType !== "public") {
    return response(res, 400, "This event is not open for public registration");
  }

  if (event.registrations >= event.capacity) {
    return response(res, 400, "Event capacity is full");
  }

  const eventId = event._id;

  if (!fullName || !email || !phone) {
    return response(res, 400, "Full name, email, and phone are required");
  }

  const duplicate = await Registration.findOne({
    $or: [{ email }, { phone }],
    eventId,
  });

  if (duplicate) {
    return response(res, 409, "Already registered with this email or phone");
  }

  const newRegistration = await Registration.create({
    eventId,
    fullName,
    email,
    phone,
    company,
  });

  event.registrations += 1;
  await event.save();

  return response(res, 201, "Registration successful", newRegistration);
});

// GET paginated registrations by event using slug
exports.getRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const event = await Event.findOne({ slug });
  if (!event) return response(res, 404, "Event not found");

  if (event.eventType !== "public") {
    return response(res, 400, "This event is not public");
  }

  const eventId = event._id;
  const totalRegistrations = await Registration.countDocuments({ eventId });

  const registrations = await Registration.find({ eventId })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const enhanced = registrations.map((reg) => ({
    _id: reg._id,
    fullName: reg.fullName,
    email: reg.email,
    phone: reg.phone,
    company: reg.company,
  }));

  return response(res, 200, "Registrations fetched", {
    data: enhanced,
    pagination: {
      totalRegistrations,
      totalPages: Math.ceil(totalRegistrations / limit) || 1,
      currentPage: Number(page),
      perPage: Number(limit),
    },
  });
});

// DELETE registration
exports.deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  const registration = await Registration.findById(id);
  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  await Registration.findByIdAndDelete(id);
  await Event.findByIdAndUpdate(registration.eventId, {
    $inc: { registrations: -1 },
  });

  return response(res, 200, "Registration deleted successfully");
});
