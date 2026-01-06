const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const env = require("../../config/env");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");

// GET all closed events
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
    eventType: "closed",
  })
    .notDeleted()
    .sort({ startDate: -1 });

  return response(res, 200, "CheckIn Events fetched successfully", {
    events,
    totalEvents: events.length,
  });
});

// GET single event by slug
exports.getEventBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const event = await Event.findOne({ slug }).notDeleted();

  if (!event || event.eventType !== "closed") {
    return response(res, 400, "Closed event not found");
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
  if (!event || event.eventType !== "closed") {
    return response(res, 400, "Closed event not found");
  }

  return response(res, 200, "Event fetched successfully", event);
});

// Validate phone number
const validatePhoneNumber = (phone) => {
  if (!phone) return { valid: true };
  const phoneStr = String(phone).trim();

  if (!phoneStr.startsWith("+")) {
    return { valid: false, error: "Phone number must start with country code (e.g., +92, +968, +1)" };
  }

  const digits = phoneStr.replace(/\D/g, "");

  if (phoneStr.startsWith("+92")) {
    const localDigits = digits.replace(/^92/, "");
    if (localDigits.length !== 10) {
      return { valid: false, error: "Pakistan phone number must be 10 digits (excluding country code +92)" };
    }
    return { valid: true };
  }

  if (phoneStr.startsWith("+968")) {
    const localDigits = digits.replace(/^968/, "");
    if (localDigits.length !== 8) {
      return { valid: false, error: "Oman phone number must be 8 digits (excluding country code +968)" };
    }
    return { valid: true };
  }

  if (digits.length < 8) {
    return { valid: false, error: "Phone number is too short" };
  }
  if (digits.length > 15) {
    return { valid: false, error: "Phone number is too long" };
  }

  return { valid: true };
};

// CREATE closed event
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
    showQrOnBadge,
    requiresApproval,
    defaultLanguage,
    logoUrl,
    background,
    brandingMedia,
    agendaUrl,
    formFields,
    organizerName,
    organizerEmail,
    organizerPhone,
  } = req.body;
  let { capacity } = req.body;

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
  if (!business) {
    return response(res, 404, "Business not found");
  }
  const businessId = business._id;
  const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);
  if (!capacity || isNaN(Number(capacity)) || Number(capacity) <= 0) {
    capacity = 999;
  }

  let parsedBackground = {};
  if (background) {
    try {
      parsedBackground =
        typeof background === "string" ? JSON.parse(background) : background;

      if (parsedBackground.en?.url) {
        const url = parsedBackground.en.url;
        const base = env.aws.cloudfrontUrl.endsWith("/")
          ? env.aws.cloudfrontUrl
          : env.aws.cloudfrontUrl + "/";
        parsedBackground.en.key = decodeURIComponent(url.replace(base, ""));
      }
      if (parsedBackground.ar?.url) {
        const url = parsedBackground.ar.url;
        const base = env.aws.cloudfrontUrl.endsWith("/")
          ? env.aws.cloudfrontUrl
          : env.aws.cloudfrontUrl + "/";
        parsedBackground.ar.key = decodeURIComponent(url.replace(base, ""));
      }
    } catch {
      parsedBackground = {};
    }
  }

  let parsedBrandingMedia = [];
  if (brandingMedia) {
    try {
      parsedBrandingMedia =
        typeof brandingMedia === "string"
          ? JSON.parse(brandingMedia)
          : brandingMedia;
      if (!Array.isArray(parsedBrandingMedia)) parsedBrandingMedia = [];
    } catch {
      parsedBrandingMedia = [];
    }
  }

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
          visible: field.visible !== false,
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
    ...(Object.keys(parsedBackground).length > 0
      ? { background: parsedBackground }
      : {}),
    ...(parsedBrandingMedia.length ? { brandingMedia: parsedBrandingMedia } : {}),
    agendaUrl: agendaUrl || null,
    capacity,
    businessId,
    eventType: "closed",
    formFields: parsedFormFields,
    showQrAfterRegistration,
    showQrOnBadge,
    requiresApproval: requiresApproval === "true" || requiresApproval === true,
    defaultLanguage: defaultLanguage || "en",
    organizerName: organizerName || "",
    organizerEmail: organizerEmail || "",
    organizerPhone: organizerPhone || "",
  });

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 201, "Closed event created successfully", newEvent);
});

// UPDATE closed event
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
    showQrAfterRegistration,
    showQrOnBadge,
    requiresApproval,
    defaultLanguage,
    logoUrl,
    background,
    brandingMedia,
    agendaUrl,
    removeLogo,
    removeBackgroundEn,
    removeBackgroundAr,
    formFields,
    clearAllBrandingLogos,
    removeBrandingLogoIds,
    organizerName,
    organizerEmail,
    organizerPhone,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event || event.eventType !== "closed") {
    return response(res, 404, "Closed event not found");
  }

  let parsedStartDate = startDate ? new Date(startDate) : event.startDate;
  let parsedEndDate = endDate ? new Date(endDate) : event.endDate;

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

  if (capacity && Number(capacity) > 0) updates.capacity = capacity;

  if (slug && slug !== event.slug) {
    const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);
    updates.slug = uniqueSlug;
  }

  if (logoUrl !== undefined) {
    if (event.logoUrl && event.logoUrl !== logoUrl) {
      try {
        await deleteFromS3(event.logoUrl);
      } catch { }
    }
    updates.logoUrl = logoUrl || null;
  }

  if (background !== undefined) {
    let parsedBackground = {};
    try {
      parsedBackground =
        typeof background === "string" ? JSON.parse(background) : background;
    } catch {
      parsedBackground = {};
    }

    if (event.background?.en?.key || event.background?.en?.url) {
      const newEnUrl = parsedBackground.en?.url;
      if (
        !newEnUrl ||
        newEnUrl !== (event.background.en.url || event.background.en.key)
      ) {
        try {
          await deleteFromS3(event.background.en.key || event.background.en.url);
        } catch { }
      }
    }

    if (event.background?.ar?.key || event.background?.ar?.url) {
      const newArUrl = parsedBackground.ar?.url;
      if (
        !newArUrl ||
        newArUrl !== (event.background.ar.url || event.background.ar.key)
      ) {
        try {
          await deleteFromS3(event.background.ar.key || event.background.ar.url);
        } catch { }
      }
    }

    if (parsedBackground.en?.url && !parsedBackground.en.key) {
      const url = parsedBackground.en.url;
      const base = env.aws.cloudfrontUrl.endsWith("/")
        ? env.aws.cloudfrontUrl
        : env.aws.cloudfrontUrl + "/";
      parsedBackground.en.key = decodeURIComponent(url.replace(base, ""));
    }
    if (parsedBackground.ar?.url && !parsedBackground.ar.key) {
      const url = parsedBackground.ar.url;
      const base = env.aws.cloudfrontUrl.endsWith("/")
        ? env.aws.cloudfrontUrl
        : env.aws.cloudfrontUrl + "/";
      parsedBackground.ar.key = decodeURIComponent(url.replace(base, ""));
    }

    if (Object.keys(parsedBackground).length > 0) {
      updates.background = parsedBackground;
    }
  }

  if (removeLogo === "true") {
    if (event.logoUrl) {
      try {
        await deleteFromS3(event.logoUrl);
      } catch { }
    }
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

  if (clearAllBrandingLogos === "true") {
    if (Array.isArray(event.brandingMedia) && event.brandingMedia.length) {
      for (const media of event.brandingMedia) {
        if (media?.logoUrl) {
          try {
            await deleteFromS3(media.logoUrl);
          } catch { }
        }
      }
    }
    updates.brandingMedia = [];
  } else if (brandingMedia !== undefined) {
    let parsedBrandingMedia = [];
    try {
      parsedBrandingMedia =
        typeof brandingMedia === "string"
          ? JSON.parse(brandingMedia)
          : brandingMedia;
      if (!Array.isArray(parsedBrandingMedia)) parsedBrandingMedia = [];
    } catch {
      parsedBrandingMedia = [];
    }

    const removeIds = removeBrandingLogoIds
      ? typeof removeBrandingLogoIds === "string"
        ? JSON.parse(removeBrandingLogoIds)
        : removeBrandingLogoIds
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

  if (agendaUrl !== undefined) {
    if (event.agendaUrl && event.agendaUrl !== agendaUrl) {
      try {
        await deleteFromS3(event.agendaUrl);
      } catch { }
    }
    updates.agendaUrl = agendaUrl || null;
  }

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
          visible: field.visible !== false,
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
    updates.showQrOnBadge =
      showQrOnBadge === "true" || showQrOnBadge === true;
  }

  if (
    typeof requiresApproval === "boolean" ||
    requiresApproval === "true" ||
    requiresApproval === "false"
  ) {
    updates.requiresApproval =
      requiresApproval === "true" || requiresApproval === true;
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

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    "Closed event updated successfully",
    updatedEvent
  );
});

// SOFT DELETE closed event
exports.deleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event || event.eventType !== "closed") {
    return response(res, 404, "Event not found");
  }

  await event.softDelete(req.user?.id);

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Event moved to Recycle Bin");
});

// PERMANENT DELETE closed event (cascade registrations + walk-ins)
exports.permanentDeleteEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response(res, 400, "Invalid Event ID");
  }

  const event = await Event.findById(id);
  if (!event || event.eventType !== "closed") {
    return response(res, 404, "Closed event not found");
  }

  // Check if registrations exist
  const regs = await Registration.find({ eventId: event._id });
  if (regs.length > 0) {
    return response(
      res,
      400,
      "Cannot delete event with existing registrations"
    );
  }

  if (event.logoUrl) await deleteImage(event.logoUrl);
  if (event.brandingMediaUrl) await deleteImage(event.brandingMediaUrl);
  if (event.agendaUrl) await deleteImage(event.agendaUrl);

  const businessId = event.businessId;

  await event.deleteOne();

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Closed event permanently deleted");
});

// RESTORE ALL
exports.restoreAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "closed" });
  if (!events.length) return response(res, 404, "No closed events in trash");

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

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, `Restored ${events.length} events`);
});

// PERMANENT DELETE ALL closed events (only those without registrations)
exports.permanentDeleteAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "closed" });
  if (!events.length) {
    return response(res, 404, "No closed events in trash");
  }

  const deletableEventIds = [];
  for (const ev of events) {
    const regCount = await Registration.countDocuments({ eventId: ev._id });
    if (regCount === 0) {
      deletableEventIds.push(ev._id);
    }
  }

  const result = await Event.deleteMany({ _id: { $in: deletableEventIds } });

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Permanently deleted ${result.deletedCount} closed events (without registrations)`
  );
});
