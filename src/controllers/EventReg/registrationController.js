const mongoose = require("mongoose");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const QRCode = require("qrcode");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
const Event = require("../../models/Event");
const asyncHandler = require("../../middlewares/asyncHandler");
const response = require("../../utils/response");
const sendEmail = require("../../services/emailService");
const sendWhatsappMessage = require("../../services/whatsappService");

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
<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 0 8px rgba(0,0,0,0.1); overflow: hidden;">
    <div style="background-color: #007BFF; padding: 20px; text-align: center;">
      <h2 style="color: #fff; margin: 0;">Welcome to ${event.name}</h2>
    </div>
    <div style="padding: 30px;">
      <p style="font-size: 16px;">Hi <strong>${fullName}</strong>,</p>
      <p style="font-size: 16px;">We are excited to confirm your registration for the event <strong>${
        event.name
      }</strong>!</p>

      ${
        event.logoUrl
          ? `<div style="text-align: center; margin: 20px 0;">
               <img src="${event.logoUrl}" alt="Event Logo" style="max-width: 180px; max-height: 100px;" />
             </div>`
          : ""
      }

      <p style="font-size: 16px;">Here are the event details:</p>
      <ul style="font-size: 15px; line-height: 1.6; padding-left: 20px;">
        <li><strong>Date:</strong> ${event.date.toDateString()}</li>
        <li><strong>Venue:</strong> ${event.venue}</li>
        ${
          event.description
            ? `<li><strong>About the Event:</strong> ${event.description}</li>`
            : ""
        }
      </ul>

      <p style="font-size: 16px;">Please present the following QR code at the entrance for check-in:</p>

      <div style="text-align: center; margin: 25px 0;">
        {{qrImage}}
      </div>

      <p style="text-align: center; font-size: 14px; color: #555;">Your Unique Token:</p>
      <p style="text-align: center; font-size: 20px; font-weight: bold; color: #000;">${
        newRegistration.token
      }</p>

      <hr style="margin: 30px 0;" />

      <p style="font-size: 14px;">If you have any questions or need support, feel free to reply to this email.</p>
      <p style="font-size: 14px;">We look forward to seeing you there!</p>
      <p style="font-size: 14px;">Warm regards,<br /><strong>${
        event.name
      }</strong> Team</p>
    </div>
  </div>
  <div style="text-align: center; font-size: 12px; color: #aaa; margin-top: 20px;">
    &copy; ${new Date().getFullYear()} EventPass. All rights reserved.
  </div>
</div>
`;

  // Send email
  await sendEmail(
    email,
    `Registration Confirmed: ${event.name}`,
    emailHtml,
    qrCodeDataUrl
  );

  // Generate QR code buffer
  const qrCodeBuffer = await QRCode.toBuffer(newRegistration.token);

  // Upload QR to Cloudinary
  const qrUploadResult = await uploadToCloudinary(qrCodeBuffer, "image/png");
  const qrImageUrl = qrUploadResult.secure_url;

  // Send WhatsApp message
  const whatsappText = `Hi ${fullName}, you’ve successfully registered for "${event.name}". Please show this QR code at check-in:`;
  await sendWhatsappMessage(phone, whatsappText, qrImageUrl);

  return response(res, 201, "Registration successful", newRegistration);
});

// GET paginated registrations by event using slug (includes walk-ins)
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

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });
      return {
        _id: reg._id,
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        company: reg.company,
        token: reg.token,
        createdAt: reg.createdAt,
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

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

  if (!staffUser?.id) {
    return response(res, 401, "Unauthorized – no scanner info");
  }

  const registration = await Registration.findOne({ token }).populate(
    "eventId"
  );

  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  // Create a WalkIn record
  const walkin = new WalkIn({
    registrationId: registration._id,
    eventId: registration.eventId?._id,
    scannedBy: staffUser.id,
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
