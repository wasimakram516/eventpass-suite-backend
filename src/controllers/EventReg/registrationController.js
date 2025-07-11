const mongoose = require("mongoose");
const QRCode = require("qrcode");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const sendEmail = require("../../utils/emailService");

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

  const qrCodeDataUrl = await QRCode.toDataURL(newRegistration.token);

  // Prepare HTML email
  const emailHtml = `
  <p>Hi ${fullName},</p>
  <p>You’ve successfully registered for <strong>${event.name}</strong>.</p>
  <p>Please show this QR code at the venue for check-in:</p>
  {{qrImage}}
  <p><strong>${newRegistration.token}</strong></p>
  <p>Thank you,<br/><strong>${event.name}</strong> Team</p>
`;

  // Send email
  await sendEmail(
    email,
    `Registration Confirmed: ${event.name}`,
    emailHtml,
    qrCodeDataUrl
  );

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
    token: reg.token,
    createdAt: reg.createdAt,
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

// VERIFY registration by QR token and create a WalkIn
exports.verifyRegistrationByToken = asyncHandler(async (req, res) => {
  const { token } = req.query;
  const staffUser = req.user; 

  if (!token) {
    return response(res, 400, "Token is required");
  }

  const registration = await Registration.findOne({ token }).populate("eventId");

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  // Create a WalkIn record
  const walkin = new WalkIn({
    registrationId: registration._id,
    eventId: registration.eventId?._id,
    scannedBy: staffUser._id,
  });

  await walkin.save();

  return response(res, 200, "Registration verified and walk-in recorded", {
    fullName: registration.fullName,
    email: registration.email,
    phone: registration.phone,
    company: registration.company,
    eventName: registration.eventId?.name || "Unknown Event",
    eventId: registration.eventId?._id,
    createdAt: registration.createdAt,
    walkinId: walkin._id,
    scannedAt: walkin.scannedAt,
    scannedBy: {
      _id: staffUser._id,
      name: staffUser.name || staffUser.email,
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
