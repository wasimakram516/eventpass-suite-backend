const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const response = require("../../utils/response");

// Get all events for a business
exports.getEventDetails = asyncHandler(async (req, res) => {
  const { businessSlug } = req.query;

  if (!businessSlug) {
    return response(res, 400, "Business slug is required");
  }

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) {
    return response(res, 404, "Business not found");
  }

  const businessId = business._id;

  const events = await Event.find({
    businessId,
    eventType: "public",
  })
  .notDeleted()
  .sort({ startDate: -1 });

  return response(res, 200, "Events fetched successfully.", {
    events,
    totalEvents: events.length,
  });
});

// Get a single event by Slug
exports.getEventBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const event = await Event.findOne({ slug }).notDeleted();
  if (!event || event.eventType !== "public") {
    return response(res, 400, "Public event not found");
  }

  return response(res, 200, "Event fetched successfully.", event);
});

// GET single event by ID
exports.getEventById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id).notDeleted();
  if (!event || event.eventType !== "public") {
    return response(res, 400, "Public event not found");
  }

  return response(res, 200, "Event fetched successfully.", event);
});

// Get all events by Business ID
exports.getEventsByBusinessId = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    return response(res, 400, "Invalid businessId");
  }

  const events = await Event.find({
    businessId,
    eventType: "public",
  })
  .notDeleted()
  .sort({ startDate: -1 });

  return response(res, 200, "Events fetched successfully.", {
    events,
    totalEvents: events.length,
  });
});

// Get all events by Business Slug
exports.getEventsByBusinessSlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const business = await Business.findOne({ slug }).notDeleted();
  if (!business) {
    return response(res, 404, "Business not found");
  }

  const events = await Event.find({
    businessId: business._id,
    eventType: "public",
  })
  .notDeleted()
  .sort({ startDate: -1 });

  return response(res, 200, "Events fetched successfully.", {
    events,
    totalEvents: events.length,
  });
});

// CREATE event (only public)
exports.createEvent = asyncHandler(async (req, res) => {
  const {
    name,
    slug,
    startDate,
    endDate,
    venue,
    description,
    businessSlug,
    showQrAfterRegistration,
  } = req.body;

  let { capacity, formFields } = req.body;

  if (!name || !slug || !startDate || !endDate || !venue || !businessSlug) {
    return response(res, 400, "Missing required fields");
  }

  const parsedStartDate = new Date(startDate);
  const parsedEndDate = new Date(endDate);

  if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
    return response(res, 400, "Invalid start or end date");
  }

  if (parsedEndDate < parsedStartDate) {
    return response(
      res,
      400,
      "End date must be greater than or equal to start date"
    );
  }

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) {
    return response(res, 404, "Business not found");
  }

  const businessId = business._id;
  const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);

  if (!capacity || isNaN(Number(capacity)) || Number(capacity) <= 0) {
    capacity = 999;
  }

  let logoUrl = null;
  if (req.files?.logo) {
    const uploadResult = await uploadToCloudinary(
      req.files.logo[0].buffer,
      req.files.logo[0].mimetype
    );
    logoUrl = uploadResult.secure_url;
  }
  let brandingMediaUrl = null;
  if (req.files?.brandingMedia) {
    const uploadResult = await uploadToCloudinary(
      req.files.brandingMedia[0].buffer,
      req.files.brandingMedia[0].mimetype
    );
    brandingMediaUrl = uploadResult.secure_url;
  }
  // Parse and validate formFields (stringified JSON from FormData)
  let parsedFormFields = [];
  if (formFields) {
    try {
      const rawFields =
        typeof formFields === "string" ? JSON.parse(formFields) : formFields;
      if (Array.isArray(rawFields)) {
        parsedFormFields = rawFields.map((field) => ({
          inputName: field.inputName,
          inputType: field.inputType,
          values:
            ["radio", "list"].includes(field.inputType) &&
            Array.isArray(field.values)
              ? field.values
              : [],
          required: field.required === true,
        }));
      }
    } catch (err) {
      console.error("Invalid formFields:", err);
      return response(res, 400, "Invalid format for formFields");
    }
  }

  const newEvent = await Event.create({
    name,
    slug: uniqueSlug,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
    venue,
    description,
    logoUrl,
    brandingMediaUrl,
    capacity,
    businessId,
    formFields: parsedFormFields,
    showQrAfterRegistration,
  });

  return response(res, 201, "Event created successfully", newEvent);
});

// UPDATE event (only public)
exports.updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    slug,
    startDate,
    endDate,
    venue,
    description,
    capacity,
    formFields,
    showQrAfterRegistration,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID.");
  }

  const event = await Event.findById(id);
  if (!event) {
    return response(res, 404, "Event not found");
  }

  const parsedStartDate = startDate ? new Date(startDate) : event.startDate;
  const parsedEndDate = endDate ? new Date(endDate) : event.endDate;

  if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
    return response(res, 400, "Invalid start or end date");
  }

  if (parsedEndDate < parsedStartDate) {
    return response(
      res,
      400,
      "End date must be greater than or equal to start date"
    );
  }

  const updates = {
    name,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
    venue,
    description,
  };

  if (capacity && Number(capacity) > 0) {
    updates.capacity = Number(capacity);
  }

  if (slug && slug !== event.slug) {
    const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);
    updates.slug = uniqueSlug;
  }

  if (req.files?.logo) {
    if (event.logoUrl) {
      await deleteImage(event.logoUrl);
    }
    const uploadResult = await uploadToCloudinary(
      req.files.logo[0].buffer,
      req.files.logo[0].mimetype
    );
    updates.logoUrl = uploadResult.secure_url;
  }
  if (req.files?.brandingMedia) {
    if (event.brandingMediaUrl) {
      await deleteImage(event.brandingMediaUrl);
    }
    const uploadResult = await uploadToCloudinary(
      req.files.brandingMedia[0].buffer,
      req.files.brandingMedia[0].mimetype
    );
    updates.brandingMediaUrl = uploadResult.secure_url;
  }
  // Handle updated formFields (string or array)
  let parsedFormFields =[];
  if (formFields) {
    try {
      const rawFields =
        typeof formFields === "string" ? JSON.parse(formFields) : formFields;
      if (Array.isArray(rawFields)) {
        parsedFormFields = rawFields.map((field) => ({
          inputName: field.inputName,
          inputType: field.inputType,
          values:
            ["radio", "list"].includes(field.inputType) &&
            Array.isArray(field.values)
              ? field.values
              : [],
          required: field.required === true,
        }));
      }
    } catch (err) {
      console.error("Invalid formFields format:", err);
      return response(res, 400, "Invalid format for formFields");
    }
  }

  updates.formFields = parsedFormFields;

  if (typeof showQrAfterRegistration === "boolean" || showQrAfterRegistration === "true" || showQrAfterRegistration === "false") {
  updates.showQrAfterRegistration = showQrAfterRegistration === "true" || showQrAfterRegistration === true;
}

  const updatedEvent = await Event.findByIdAndUpdate(id, updates, {
    new: true,
  });

  return response(res, 200, "Event updated successfully", updatedEvent);
});

// Soft delete event
exports.deleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event || event.eventType !== "public") {
    return response(res, 404, "Public event not found");
  }

  const registrationsCount = await Registration.countDocuments({ eventId: id });
  if (registrationsCount > 0) {
    return response(res, 400, "Cannot delete an event with existing registrations");
  }

  await event.softDelete(req.user.id);
  return response(res, 200, "Event moved to recycle bin");
});

// Restore event
exports.restoreEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneDeleted({ _id: req.params.id, eventType: "public" });
  if (!event) return response(res, 404, "Event not found in trash");

  await event.restore();
  return response(res, 200, "Event restored", event);
});

// Permanent delete event
exports.permanentDeleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneDeleted({ _id: req.params.id, eventType: "public" });
  if (!event) return response(res, 404, "Event not found in trash");

  if (event.logoUrl) await deleteImage(event.logoUrl);
  if (event.brandingMediaUrl) await deleteImage(event.brandingMediaUrl);

  await event.deleteOne();
  return response(res, 200, "Event permanently deleted");
});
