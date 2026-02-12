const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");
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

  const business = await Business.findOne({ slug: businessSlug });
  if (!business) {
    return response(res, 404, "Business not found");
  }

  const businessId = business._id;

  const events = await Event.find({
    businessId,
    eventType: "closed",
  })
    
    .sort({ startDate: -1 })
    .populate("createdBy", "name")
    .populate("updatedBy", "name");

  return response(res, 200, "CheckIn Events fetched successfully", {
    events,
    totalEvents: events.length,
  });
});

// GET single event by slug
exports.getEventBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const event = await Event.findOne({ slug });

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

  const event = await Event.findById(id);
  if (!event || event.eventType !== "closed") {
    return response(res, 400, "Closed event not found");
  }

  return response(res, 200, "Event fetched successfully", event);
});

// Validate phone number
const { validatePhoneNumberByCountry } = require("../../utils/phoneValidation");

const validatePhoneNumber = (phone) => {
  if (!phone) return { valid: true };
  return validatePhoneNumberByCountry(phone);
};

// CREATE closed event
exports.createEvent = asyncHandler(async (req, res) => {
  const {
    name,
    slug,
    startDate,
    endDate,
    startTime,
    endTime,
    timezone,
    venue,
    description,
    businessSlug,
    showQrAfterRegistration,
    showQrOnBadge,
    requiresApproval,
    useInternationalNumbers,
    defaultLanguage,
    logoUrl,
    background,
    brandingMedia,
    agendaUrl,
    formFields,
    organizerName,
    organizerEmail,
    organizerPhone,
    useCustomQrCode,
    customQrWrapperBackgroundUrl,
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

  const eventPayload = {
    name,
    slug: uniqueSlug,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
    startTime: startTime || null,
    endTime: endTime || null,
    timezone: timezone || "Asia/Muscat",
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
    useInternationalNumbers: useInternationalNumbers === "true" || useInternationalNumbers === true,
    defaultLanguage: defaultLanguage || "en",
    organizerName: organizerName || "",
    organizerEmail: organizerEmail || "",
    organizerPhone: organizerPhone || "",
    useCustomQrCode: useCustomQrCode === true || useCustomQrCode === "true",
    ...(customQrWrapperBackgroundUrl && String(customQrWrapperBackgroundUrl).trim()
      ? {
          customQrWrapper: {
            brandingMedia: { items: [] },
            customFields: [],
            backgroundImage: { url: String(customQrWrapperBackgroundUrl).trim() },
          },
        }
      : {}),
  };
  const newEvent = req.user
    ? await Event.createWithAuditUser(eventPayload, req.user)
    : await Event.create(eventPayload);

  // Fire background recompute
  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Event.findById(newEvent._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(res, 201, "Closed event created successfully", populated || newEvent);
});

// UPDATE closed event
exports.updateEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    slug,
    startDate,
    endDate,
    startTime,
    endTime,
    timezone,
    venue,
    description,
    capacity,
    showQrAfterRegistration,
    showQrOnBadge,
    requiresApproval,
    useInternationalNumbers,
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
    useCustomQrCode,
    customQrWrapperBackgroundUrl,
    removeQrWrapperBackground,
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

  if (startTime !== undefined) {
    updates.startTime = startTime || null;
  }
  if (endTime !== undefined) {
    updates.endTime = endTime || null;
  }
  if (timezone !== undefined) {
    updates.timezone = timezone || "Asia/Muscat";
  }

  if (
    typeof useCustomQrCode === "boolean" ||
    useCustomQrCode === "true" ||
    useCustomQrCode === "false"
  ) {
    updates.useCustomQrCode =
      useCustomQrCode === "true" || useCustomQrCode === true;
  }

  if (removeQrWrapperBackground === "true" || removeQrWrapperBackground === true) {
    if (event.customQrWrapper?.backgroundImage?.url) {
      try {
        await deleteFromS3(event.customQrWrapper.backgroundImage.url);
      } catch (err) {
        console.warn("Failed to delete event QR wrapper background from S3:", err);
      }
    }
    updates.customQrWrapper = {
      ...(event.customQrWrapper || {}),
      backgroundImage: { url: "" },
    };
  } else if (customQrWrapperBackgroundUrl !== undefined && customQrWrapperBackgroundUrl !== null && customQrWrapperBackgroundUrl !== "") {
    if (event.customQrWrapper?.backgroundImage?.url && event.customQrWrapper.backgroundImage.url !== customQrWrapperBackgroundUrl) {
      try {
        await deleteFromS3(event.customQrWrapper.backgroundImage.url);
      } catch (err) {
        console.warn("Failed to delete previous event QR wrapper background from S3:", err);
      }
    }
    updates.customQrWrapper = {
      ...(event.customQrWrapper || {}),
      backgroundImage: { url: String(customQrWrapperBackgroundUrl) },
    };
  }

  if (req.user) {
    updates.updatedBy = req.user._id ?? req.user.id;
  }

  const updatedEvent = await Event.findByIdAndUpdate(id, updates, {
    new: true,
  });

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  const populated = await Event.findById(updatedEvent._id)
    .populate("createdBy", "name")
    .populate("updatedBy", "name");
  return response(
    res,
    200,
    "Closed event updated successfully",
    populated || updatedEvent
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

  const event = await Event.findOneDeleted({
    _id: id,
    eventType: "closed",
  });
  if (!event) {
    return response(res, 404, "Closed event not found in trash");
  }

  const regs = await Registration.find({ eventId: event._id });
  const regIds = regs.map((r) => r._id);

  if (regIds.length > 0) {
    await WalkIn.deleteMany({ registrationId: { $in: regIds } });
    await Registration.deleteMany({ eventId: event._id });
  }

  if (event.logoUrl) await deleteFromS3(event.logoUrl);
  if (event.brandingMediaUrl) await deleteFromS3(event.brandingMediaUrl);
  if (event.agendaUrl) await deleteFromS3(event.agendaUrl);
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

  const businessId = event.businessId;
  await event.deleteOne();

  recomputeAndEmit(businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(res, 200, "Closed event and its registrations permanently deleted");
});

// Restore event
exports.restoreEvent = asyncHandler(async (req, res) => {
  const event = await Event.findOneDeleted({
    _id: req.params.id,
    eventType: "closed",
  });
  if (!event) return response(res, 404, "Event not found in trash");

  const conflict = await Event.findOne({
    _id: { $ne: event._id },
    slug: event.slug,
    isDeleted: { $ne: true },
  });
  if (conflict) {
    return response(res, 409, "Cannot restore: slug already in use");
  }

  await event.restore();

  // Fire background recompute
  recomputeAndEmit(event.businessId || null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );
  return response(res, 200, "Event restored successfully", event);
});

// RESTORE ALL
exports.restoreAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "closed" });
  if (!events.length) return response(res, 404, "No closed events in trash");

  let restoredCount = 0;
  let skippedCount = 0;

  for (const ev of events) {
    const conflict = await Event.findOne({
      _id: { $ne: ev._id },
      slug: ev.slug,
      isDeleted: { $ne: true },
    });
    if (!conflict) {
      await ev.restore();
      restoredCount++;
    } else {
      skippedCount++;
    }
  }

  // Fire background recompute
  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Restored ${restoredCount} events${skippedCount ? `, skipped ${skippedCount} due to slug conflict` : ""}`
  );
});

// PERMANENT DELETE ALL closed events (cascade delete registrations + walk-ins)
exports.permanentDeleteAllEvents = asyncHandler(async (req, res) => {
  const events = await Event.findDeleted({ eventType: "closed" });
  if (!events.length) {
    return response(res, 404, "No closed events in trash");
  }

  const eventIds = events.map((ev) => ev._id);

  const regs = await Registration.find({ eventId: { $in: eventIds } });
  const regIds = regs.map((r) => r._id);

  if (regIds.length > 0) {
    await WalkIn.deleteMany({ registrationId: { $in: regIds } });
    await Registration.deleteMany({ eventId: { $in: eventIds } });
  }

  const result = await Event.deleteMany({ _id: { $in: eventIds } });

  recomputeAndEmit(null).catch((err) =>
    console.error("Background recompute failed:", err.message)
  );

  return response(
    res,
    200,
    `Permanently deleted ${result.deletedCount} closed events and their registrations`
  );
});
