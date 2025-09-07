const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const { processEmployeeData } = require("../../utils/eventUtils");
const { uploadToCloudinary } = require("../../utils/uploadToCloudinary");
const { deleteImage } = require("../../config/cloudinary");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const response = require("../../utils/response");

// GET all employee events
exports.getEventDetails = asyncHandler(async (req, res) => {
  const { businessSlug } = req.query;

  if (!businessSlug) {
    return response(res, 400, "Business slug is required");
  }

  const business = await Business.findOne({ slug: businessSlug }).notDeleted();
  if (!business) {
    return response(res, 404, "Business not found");
  }

  const businessId = business._id;

  const events = await Event.find({
    businessId,
    eventType: "employee",
  }).notDeleted().sort({ startDate: -1 });

  return response(res, 200, "CheckIn Events fetched successfully", {
    events,
    totalEvents: events.length,
  });
});

// GET single event by slug
exports.getEventBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const event = await Event.findOne({ slug }).notDeleted();

  if (!event || event.eventType !== "employee") {
    return response(res, 400, "Employee event not found");
  }

  return response(res, 200, "Event fetched successfully", event);
});

// GET single event by ID
exports.getEventById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id).notDeleted();
  if (!event || event.eventType !== "employee") {
    return response(res, 400, "Employee event not found");
  }

  return response(res, 200, "Event fetched successfully", event);
});

// CREATE employee event
exports.createEvent = asyncHandler(async (req, res) => {
  const { name, slug, startDate, endDate, venue, description, businessSlug } = req.body;
  let { capacity } = req.body;

  if (!name || !slug || !startDate || !endDate || !venue || !businessSlug) {
    return response(res, 400, "Missing required fields");
  }

  const parsedStartDate = new Date(startDate);
  const parsedEndDate = new Date(endDate);

  if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
    return response(res, 400, "Invalid start or end date");
  }

  if (parsedEndDate < parsedStartDate) {
    return response(res, 400, "End date must be greater than or equal to start date");
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

  let employeeData = [];
  if (!req.files?.employeeData?.[0]) {
    return response(res, 400, "Employee data file is required");
  }

  try {
    employeeData = await processEmployeeData(
      req.files.employeeData[0].buffer,
      req.files.tableImages || []
    );
  } catch (err) {
    return response(res, 500, err.message);
  }

  const newEvent = await Event.create({
    name,
    slug: uniqueSlug,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
    venue,
    description,
    logoUrl,
    capacity,
    businessId,
    eventType: "employee",
    employeeData,
  });

  return response(res, 201, "Employee event created successfully", newEvent);
});

// UPDATE employee event
exports.updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, slug, startDate, endDate, venue, description, capacity } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event || event.eventType !== "employee") {
    return response(res, 404, "Employee event not found");
  }

  let parsedStartDate = startDate ? new Date(startDate) : event.startDate;
  let parsedEndDate = endDate ? new Date(endDate) : event.endDate;

  if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
    return response(res, 400, "Invalid start or end date");
  }

  if (parsedEndDate < parsedStartDate) {
    return response(res, 400, "End date must be greater than or equal to start date");
  }

  const updates = {
    name,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
    venue,
    description,
  };

  if (capacity && Number(capacity) > 0) updates.capacity = capacity;

  if (slug && slug !== event.slug) {
    const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);
    updates.slug = uniqueSlug;
  }

  if (req.files?.logo) {
    if (event.logoUrl) await deleteImage(event.logoUrl);
    const uploadResult = await uploadToCloudinary(
      req.files.logo[0].buffer,
      req.files.logo[0].mimetype
    );
    updates.logoUrl = uploadResult.secure_url;
  }

  if (req.files?.employeeData?.[0]) {
    try {
      updates.employeeData = await processEmployeeData(
        req.files.employeeData[0].buffer,
        req.files.tableImages || []
      );
    } catch (err) {
      return response(res, 500, err.message);
    }
  }

  const updatedEvent = await Event.findByIdAndUpdate(id, updates, {
    new: true,
  });

  return response(res, 200, "Employee event updated successfully", updatedEvent);
});

// SOFT DELETE employee event
exports.deleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event || event.eventType !== "employee") {
    return response(res, 404, "Event not found");
  }

  await event.softDelete(req.user?.id);
  return response(res, 200, "Event moved to Recycle Bin");
});

// PERMANENT DELETE public event
exports.permanentDeleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event) return response(res, 404, "Event not found");

  // 🔒 Restrict if *any* registrations exist (active or trashed)
  const totalRegs = await Registration.countDocuments({ eventId: event._id });
  if (totalRegs > 0) {
    return response(
      res,
      400,
      "Cannot permanently delete an event with registrations in DB"
    );
  }

  if (event.logoUrl) await deleteImage(event.logoUrl);
  if (event.brandingMediaUrl) await deleteImage(event.brandingMediaUrl);
  if (event.agendaUrl) await deleteImage(event.agendaUrl);

  await event.deleteOne();
  return response(res, 200, "Event permanently deleted");
});

// RESTORE ALL
exports.restoreAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "employee" });
  if (!events.length) return response(res, 404, "No Employee events in trash");

  for (const ev of events) {
    const conflict = await Event.findOne({
      _id: { $ne: ev._id },
      slug: ev.slug,
      isDeleted: false,
    });
    if (!conflict) {
      await ev.restore();
    }
  }

  return response(res, 200, `Restored ${events.length} events`);
});

// PERMANENT DELETE ALL
exports.permanentDeleteAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "employee" });
  if (!events.length) return response(res, 404, "No employee events in trash");

  let deletedCount = 0;
  for (const ev of events) {
    const regCount = await Registration.countDocuments({ eventId: ev._id });
    if (regCount === 0) {
      await ev.deleteOne();
      deletedCount++;
    }
  }

  return response(res, 200, `Permanently deleted ${deletedCount} public events (without registrations)`);
});
