const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const env = require("../../config/env");

// Get all events for a business
exports.getEventDetails = asyncHandler(async (req, res) => {
  const { businessSlug } = req.query;
  if (!businessSlug) return response(res, 400, "Business slug is required");

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) return response(res, 404, "Business not found");

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

  const events = await Event.find({ businessId, eventType: "public" })
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
  if (!business) return response(res, 404, "Business not found");

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

// Validate phone number
const validatePhoneNumber = (phone) => {
  if (!phone) return { valid: true };
  const phoneStr = String(phone).trim();

  if (!phoneStr.startsWith("+")) {
    return { valid: false, error: "Phone number must start with country code (e.g., +92, +968, +1)" };
  }

  const digits = phoneStr.replace(/\D/g, "");

  if (digits.length < 8) {
    return { valid: false, error: "Phone number is too short" };
  }
  if (digits.length > 15) {
    return { valid: false, error: "Phone number is too long" };
  }

  return { valid: true };
};

// CREATE event (only public)
exports.createEvent = asyncHandler(async (req, res) => {
  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

  const {
    name,
    slug,
    startDate,
    endDate,
    venue,
    description,
    businessSlug,
    showQrAfterRegistration,
    showQrOnBadge,
    requiresApproval,
    useInternationalNumbers,
    defaultLanguage,
    organizerName,
    organizerEmail,
    organizerPhone,
  } = req.body;

  let { capacity, formFields } = req.body;

  if (!name || !slug || !startDate || !endDate || !venue || !businessSlug) {
    return response(res, 400, "Missing required fields");
  }

  if (organizerPhone) {
    const phoneValidation = validatePhoneNumber(organizerPhone);
    if (!phoneValidation.valid) {
      return response(res, 400, phoneValidation.error);
    }
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
  if (!business) return response(res, 404, "Business not found");

  const businessId = business._id;
  const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);

  if (!capacity || isNaN(Number(capacity)) || Number(capacity) <= 0) {
    capacity = 999;
  }

  const { logoUrl, background, brandingMedia, agendaUrl } = req.body;


  let parsedBackground = {};
  if (background) {
    try {
      parsedBackground = typeof background === "string" ? JSON.parse(background) : background;

      if (parsedBackground.en?.url) {
        const url = parsedBackground.en.url;
        const base = env.aws.cloudfrontUrl.endsWith("/") ? env.aws.cloudfrontUrl : env.aws.cloudfrontUrl + "/";
        parsedBackground.en.key = decodeURIComponent(url.replace(base, ""));
      }
      if (parsedBackground.ar?.url) {
        const url = parsedBackground.ar.url;
        const base = env.aws.cloudfrontUrl.endsWith("/") ? env.aws.cloudfrontUrl : env.aws.cloudfrontUrl + "/";
        parsedBackground.ar.key = decodeURIComponent(url.replace(base, ""));
      }
    } catch {
      parsedBackground = {};
    }
  }

  let parsedBrandingMedia = [];
  if (brandingMedia) {
    try {
      parsedBrandingMedia = typeof brandingMedia === "string" ? JSON.parse(brandingMedia) : brandingMedia;
      if (!Array.isArray(parsedBrandingMedia)) parsedBrandingMedia = [];
    } catch {
      parsedBrandingMedia = [];
    }
  }

  // Parse and validate formFields
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
          visible: field.visible !== false, // default true
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
    logoUrl: logoUrl || null,
    ...(Object.keys(parsedBackground).length > 0 ? { background: parsedBackground } : {}),
    ...(parsedBrandingMedia.length ? { brandingMedia: parsedBrandingMedia } : {}),
    agendaUrl: agendaUrl || null,
    capacity,
    businessId,
    formFields: parsedFormFields,
    showQrAfterRegistration,
    showQrOnBadge,
    requiresApproval: requiresApproval === "true" || requiresApproval === true,
    useInternationalNumbers: useInternationalNumbers === "true" || useInternationalNumbers === true,
    defaultLanguage: defaultLanguage || "en",
    organizerName: organizerName || "",
    organizerEmail: organizerEmail || "",
    organizerPhone: organizerPhone || "",
  });

  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Event created successfully", newEvent);
});

// UPDATE event (only public)
exports.updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!req.body) {
    return response(res, 400, "Request body is required");
  }

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
    showQrOnBadge,
    requiresApproval,
    useInternationalNumbers,
    defaultLanguage,
    removeLogo,
    removeBackgroundEn,
    removeBackgroundAr,
    organizerName,
    organizerEmail,
    organizerPhone,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID.");
  }

  const event = await Event.findById(id);
  if (!event) return response(res, 404, "Event not found");

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

  if (req.body.logoUrl !== undefined) {
    if (event.logoUrl && event.logoUrl !== req.body.logoUrl) {
      await deleteFromS3(event.logoUrl);
    }
    updates.logoUrl = req.body.logoUrl || null;
  }

  if (req.body.background !== undefined) {
    let parsedBackground = {};
    try {
      parsedBackground = typeof req.body.background === "string"
        ? JSON.parse(req.body.background)
        : req.body.background;
    } catch {
      parsedBackground = {};
    }
    if (event.background?.en?.key || event.background?.en?.url) {
      const newEnUrl = parsedBackground.en?.url;
      if (!newEnUrl || newEnUrl !== (event.background.en.url || event.background.en.key)) {
        try {
          await deleteFromS3(event.background.en.key || event.background.en.url);
        } catch { }
      }
    }
    if (event.background?.ar?.key || event.background?.ar?.url) {
      const newArUrl = parsedBackground.ar?.url;
      if (!newArUrl || newArUrl !== (event.background.ar.url || event.background.ar.key)) {
        try {
          await deleteFromS3(event.background.ar.key || event.background.ar.url);
        } catch { }
      }
    }

    if (parsedBackground.en?.url && !parsedBackground.en.key) {
      const url = parsedBackground.en.url;
      const base = env.aws.cloudfrontUrl.endsWith("/") ? env.aws.cloudfrontUrl : env.aws.cloudfrontUrl + "/";
      parsedBackground.en.key = decodeURIComponent(url.replace(base, ""));
    }
    if (parsedBackground.ar?.url && !parsedBackground.ar.key) {
      const url = parsedBackground.ar.url;
      const base = env.aws.cloudfrontUrl.endsWith("/") ? env.aws.cloudfrontUrl : env.aws.cloudfrontUrl + "/";
      parsedBackground.ar.key = decodeURIComponent(url.replace(base, ""));
    }

    if (Object.keys(parsedBackground).length > 0) {
      updates.background = parsedBackground;
    }
  }

  if (removeLogo === "true") {
    if (event.logoUrl) await deleteFromS3(event.logoUrl);
    updates.logoUrl = null;
  }

  if (removeBackgroundEn === "true") {
    if (event.background?.en?.key || event.background?.en?.url) {
      try {
        await deleteFromS3(event.background.en.key || event.background.en.url);
      } catch { }
    }
    updates.background = {
      ...(updates.background || event.background || {}),
      en: null,
    };
  }

  if (removeBackgroundAr === "true") {
    if (event.background?.ar?.key || event.background?.ar?.url) {
      try {
        await deleteFromS3(event.background.ar.key || event.background.ar.url);
      } catch { }
    }
    updates.background = {
      ...(updates.background || event.background || {}),
      ar: null,
    };
  }

  if (req.body.clearAllBrandingLogos === "true") {
    if (Array.isArray(event.brandingMedia) && event.brandingMedia.length) {
      for (const m of event.brandingMedia) {
        if (m?.logoUrl) {
          try {
            await deleteFromS3(m.logoUrl);
          } catch { }
        }
      }
    }
    updates.brandingMedia = [];
  } else if (req.body.brandingMedia !== undefined) {
    let parsedBrandingMedia = [];
    try {
      parsedBrandingMedia = typeof req.body.brandingMedia === "string"
        ? JSON.parse(req.body.brandingMedia)
        : req.body.brandingMedia;
      if (!Array.isArray(parsedBrandingMedia)) parsedBrandingMedia = [];
    } catch {
      parsedBrandingMedia = [];
    }


    const removeIds = req.body.removeBrandingLogoIds
      ? (typeof req.body.removeBrandingLogoIds === "string"
        ? JSON.parse(req.body.removeBrandingLogoIds)
        : req.body.removeBrandingLogoIds)
      : [];

    if (removeIds.length && Array.isArray(event.brandingMedia)) {
      for (const media of event.brandingMedia) {
        if (removeIds.includes(media._id?.toString()) && media.logoUrl) {
          try {
            await deleteFromS3(media.logoUrl);
          } catch { }
        }
      }
    }

    updates.brandingMedia = parsedBrandingMedia;
  }

  if (req.body.agendaUrl !== undefined) {
    if (event.agendaUrl && event.agendaUrl !== req.body.agendaUrl) {
      await deleteFromS3(event.agendaUrl);
    }
    updates.agendaUrl = req.body.agendaUrl || null;
  }

  // Handle updated formFields
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
          visible: field.visible !== false, // default true
        }));
      }
    } catch (err) {
      console.error("Invalid formFields format:", err);
      return response(res, 400, "Invalid format for formFields");
    }
  }
  updates.formFields = parsedFormFields;

  if (
    typeof showQrAfterRegistration === "boolean" ||
    showQrAfterRegistration === "true" ||
    showQrAfterRegistration === "false"
  ) {
    updates.showQrAfterRegistration =
      showQrAfterRegistration === "true" || showQrAfterRegistration === true;
  }

  if (
    typeof showQrOnBadge === "boolean" ||
    showQrOnBadge === "true" ||
    showQrOnBadge === "false"
  ) {
    updates.showQrOnBadge = showQrOnBadge === "true" || showQrOnBadge === true;
  }

  if (
    typeof requiresApproval === "boolean" ||
    requiresApproval === "true" ||
    requiresApproval === "false"
  ) {
    updates.requiresApproval =
      requiresApproval === "true" || requiresApproval === true;
  }

  if (
    typeof useInternationalNumbers === "boolean" ||
    useInternationalNumbers === "true" ||
    useInternationalNumbers === "false"
  ) {
    updates.useInternationalNumbers =
      useInternationalNumbers === "true" || useInternationalNumbers === true;
  }

  if (defaultLanguage && ["en", "ar"].includes(defaultLanguage)) {
    updates.defaultLanguage = defaultLanguage;
  }

  if (organizerName !== undefined) {
    updates.organizerName = organizerName || "";
  }
  if (organizerEmail !== undefined) {
    updates.organizerEmail = organizerEmail || "";
  }
  if (organizerPhone !== undefined) {
    if (organizerPhone) {
      const phoneValidation = validatePhoneNumber(organizerPhone);
      if (!phoneValidation.valid) {
        return response(res, 400, phoneValidation.error);
      }
    }
    updates.organizerPhone = organizerPhone || "";
  }

  const updatedEvent = await Event.findByIdAndUpdate(id, updates, {
    new: true,
  });

  recomputeAndEmit(updatedEvent.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

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

  const businessId = event.businessId;
  await event.softDelete(req.user.id);

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Event moved to recycle bin");
});

// Restore event
exports.restoreEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneDeleted({
    _id: req.params.id,
    eventType: "public",
  });
  if (!event) return response(res, 404, "Event not found in trash");

  await event.restore();

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Event restored successfully", event);
});

// Restore ALL events
exports.restoreAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "public" });
  if (!events.length) {
    return response(res, 404, "No public events found in trash to restore");
  }

  for (const ev of events) {
    await ev.restore();
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${events.length} events`);
});

// Permanent delete single event (cascade delete registrations)
exports.permanentDeleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneDeleted({
    _id: req.params.id,
    eventType: "public",
  });
  if (!event) return response(res, 404, "Event not found in trash");

  // Delete related registrations first
  await Registration.deleteMany({ eventId: event._id });

  // Delete any media
  if (event.logoUrl) await deleteFromS3(event.logoUrl);
  if (event.backgroundUrl) await deleteFromS3(event.backgroundUrl);
  // Delete background 
  if (event.background?.en?.key || event.background?.en?.url) {
    try {
      await deleteFromS3(event.background.en.key || event.background.en.url);
    } catch { }
  }
  if (event.background?.ar?.key || event.background?.ar?.url) {
    try {
      await deleteFromS3(event.background.ar.key || event.background.ar.url);
    } catch { }
  }
  if (Array.isArray(event.brandingMedia) && event.brandingMedia.length) {
    for (const m of event.brandingMedia) {
      if (m?.logoUrl) {
        try {
          await deleteFromS3(m.logoUrl);
        } catch { }
      }
    }
  }
  if (event.agendaUrl) await deleteFromS3(event.agendaUrl);

  const businessId = event.businessId;
  await event.deleteOne();

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Event and its registrations permanently deleted");
});

// Permanent delete ALL public events (cascade delete registrations)
exports.permanentDeleteAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "public" });
  if (!events.length) {
    return response(res, 404, "No public events found in trash to delete");
  }

  const eventIds = events.map((ev) => ev._id);

  // Delete related registrations for all events
  await Registration.deleteMany({ eventId: { $in: eventIds } });

  // Delete events themselves
  const result = await Event.deleteMany({ _id: { $in: eventIds } });

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Permanently deleted ${result.deletedCount} public events and their registrations`
  );
});
