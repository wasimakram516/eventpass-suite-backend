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
const {
  pickCustom,
  pickFullName,
  pickEmail,
  pickPhone,
  pickCompany,
} = require("../../utils/customFieldUtils");

// CREATE public registration
exports.createRegistration = asyncHandler(async (req, res) => {
  const { slug } = req.body;
  if (!slug) return response(res, 400, "Event slug is required");

  const event = await Event.findOne({ slug });
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public")
    return response(res, 400, "This event is not open for public registration");

  const now = new Date();
  const endOfDay = new Date(event.endDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  if (event.endDate && now > endOfDay) {
    return response(
      res,
      400,
      "Registration is closed. This event has already ended."
    );
  }

  if (event.registrations >= event.capacity)
    return response(res, 400, "Event capacity is full");

  const eventId = event._id;
  const formFields = event.formFields || [];
  const customFields = {};

  // 1) Process dynamic customFields (unchanged)…
  if (formFields.length > 0) {
    for (const field of formFields) {
      const value = req.body[field.inputName];
      if (field.required && (value == null || value === "")) {
        return response(res, 400, `Missing required field: ${field.inputName}`);
      }
      if (
        ["radio", "list"].includes(field.inputType) &&
        value &&
        !field.values.includes(value)
      ) {
        return response(
          res,
          400,
          `Invalid value for ${field.inputName}. Allowed: ${field.values.join(
            ", "
          )}`
        );
      }
      if (value != null) {
        customFields[field.inputName] = value;
      }
    }
  }

  // 2) Extract core props from either classic or custom:
  let fullName = req.body.fullName || pickFullName(customFields);
  let email = req.body.email || pickEmail(customFields);
  let phone = req.body.phone || pickPhone(customFields);
  let company = req.body.company || pickCompany(customFields);

  // 3) If no formFields, enforce classic fields:
  if (!formFields.length) {
    if (!fullName || !email || !phone) {
      return response(res, 400, "Full name, email, and phone are required");
    }
  }

  // 4) Prevent duplicates (only include clauses for fields you actually have)
  const orClauses = [];
  if (email) orClauses.push({ email });
  if (phone) orClauses.push({ phone });

  if (orClauses.length) {
    const dup = await Registration.findOne({
      eventId,
      $or: orClauses,
    });
    if (dup) {
      return response(res, 409, "Already registered with this email or phone");
    }
  }

  // 5) Create registration…
  const newRegistration = await Registration.create({
    eventId,
    fullName,
    email,
    phone,
    company,
    customFields,
  });

  // 6) Increment counter
  event.registrations += 1;
  await event.save();

  // 7) Generate QR
  const qrCodeDataUrl = await QRCode.toDataURL(newRegistration.token);
  const qrBuffer = await QRCode.toBuffer(newRegistration.token);
  const qrUpload = await uploadToCloudinary(qrBuffer, "image/png");

  // 8) Build displayName fallback
  const displayName = fullName || "Guest";

  // 9) Build customFields summary HTML
  let customFieldHtml = "";
  if (formFields.length && Object.keys(customFields).length) {
    const items = formFields
      .map((f) => {
        const v = customFields[f.inputName];
        return v ? `<li><strong>${f.inputName}:</strong> ${v}</li>` : "";
      })
      .filter(Boolean)
      .join("");
    if (items) {
      customFieldHtml = `
        <p style="font-size:16px;">Here are your submitted details:</p>
        <ul style="font-size:15px; line-height:1.6; padding-left:20px;">
          ${items}
        </ul>
      `;
    }
  }

  // 10) Email HTML (uses displayName & custom summary)
  const emailHtml = `
<div style="font-family:Arial,sans-serif;padding:20px;background:#f4f4f4;color:#333">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#007BFF;padding:20px;text-align:center">
      <h2 style="color:#fff;margin:0">Welcome to ${event.name}</h2>
    </div>
    <div style="padding:30px">
      <p>Hi <strong>${displayName}</strong>,</p>
      <p>You’re confirmed for <strong>${event.name}</strong>!</p>
      ${
        event.logoUrl
          ? `<div style="text-align:center;margin:20px 0">
               <img src="${event.logoUrl}" style="max-width:180px;max-height:100px"/>
             </div>`
          : ""
      }
      <p>Event Details:</p>
      <ul style="padding-left:20px">
        <li><strong>Date:</strong> ${event.startDate.toDateString()}${
    event.endDate && event.endDate.getTime() !== event.startDate.getTime()
      ? ` to ${event.endDate.toDateString()}`
      : ""
  }</li>
        <li><strong>Venue:</strong> ${event.venue}</li>
        ${
          event.description
            ? `<li><strong>About:</strong> ${event.description}</li>`
            : ""
        }
      </ul>
      ${customFieldHtml}
      <p>Please present this QR at check-in:</p>
      <div style="text-align:center;margin:25px 0">{{qrImage}}</div>
      <p>Your Token: <strong>${newRegistration.token}</strong></p>
      <hr/>
      <p>Questions? Reply to this email.</p>
      <p>See you soon!</p>
    </div>
  </div>
</div>
`;

  // 11) Send Email & WhatsApp if we have address/number
  if (email) {
    await sendEmail(
      email,
      `Registration Confirmed: ${event.name}`,
      emailHtml,
      qrCodeDataUrl
    );
  }
  if (phone) {
    const whatsappText = `Hi ${displayName}, you’re registered for "${event.name}". Show this QR at check-in:`;
    // await sendWhatsappMessage(phone, whatsappText, qrUpload.secure_url);
  }

  return response(res, 201, "Registration successful", newRegistration);
});

// GET paginated registrations by event using slug (includes walk-ins + customFields)
exports.getRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public") {
    return response(res, 400, "This event is not public");
  }

  const eventId = event._id;
  const totalRegistrations = await Registration.countDocuments({ eventId });

  const registrations = await Registration.find({ eventId })
    .skip((page - 1) * limit)
    .limit(limit);

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        token: reg.token,
        createdAt: reg.createdAt,

        // classic top‐level values (may be null if you used custom fields)
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        company: reg.company,

        // your entire customFields object
        customFields: reg.customFields || {},

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
      totalPages: Math.max(1, Math.ceil(totalRegistrations / limit)),
      currentPage: page,
      perPage: limit,
    },
  });
});

// GET all registrations by event using slug (for export)
exports.getAllPublicRegistrationsByEvent = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event) return response(res, 404, "Event not found");
  if (event.eventType !== "public") {
    return response(res, 400, "This event is not public");
  }

  const eventId = event._id;

  const registrations = await Registration.find({ eventId });

  const enhanced = await Promise.all(
    registrations.map(async (reg) => {
      const walkIns = await WalkIn.find({ registrationId: reg._id })
        .populate("scannedBy", "name email")
        .sort({ scannedAt: -1 });

      return {
        _id: reg._id,
        token: reg.token,
        createdAt: reg.createdAt,

        // classic fields
        fullName: reg.fullName,
        email: reg.email,
        phone: reg.phone,
        company: reg.company,

        // customFields and walk-ins
        customFields: reg.customFields || {},
        walkIns: walkIns.map((w) => ({
          scannedAt: w.scannedAt,
          scannedBy: w.scannedBy,
        })),
      };
    })
  );

  return response(res, 200, "All public registrations fetched", enhanced);
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

// Soft delete registration
exports.deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid registration ID");
  }

  const registration = await Registration.findById(id);
  if (!registration) {
    return response(res, 404, "Registration not found");
  }

  await registration.softDelete(req.user.id);

  // decrement count
  await Event.findByIdAndUpdate(registration.eventId, {
    $inc: { registrations: -1 },
  });

  return response(res, 200, "Registration moved to recycle bin");
});

// Restore registration
exports.restoreRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  await reg.restore();

  // increment count back
  await Event.findByIdAndUpdate(reg.eventId, {
    $inc: { registrations: 1 },
  });

  return response(res, 200, "Registration restored", reg);
});

// Permanent delete registration
exports.permanentDeleteRegistration = asyncHandler(async (req, res) => {
  const reg = await Registration.findOneDeleted({ _id: req.params.id });
  if (!reg) return response(res, 404, "Registration not found in trash");

  await reg.deleteOne();

  return response(res, 200, "Registration permanently deleted");
});
