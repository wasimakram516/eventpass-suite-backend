const mongoose = require("mongoose");
const asyncHandler = require("../../middlewares/asyncHandler");
const Event = require("../../models/Event");
const Business = require("../../models/Business");
const { deleteFromS3 } = require("../../utils/s3Storage");
const { generateUniqueSlug } = require("../../utils/slugGenerator");
const response = require("../../utils/response");
const { recomputeAndEmit } = require("../../socket/dashboardSocket");
const env = require("../../config/env");
const Registration = require("../../models/Registration");
const WalkIn = require("../../models/WalkIn");

const ALLOWED_EVENT_TYPE = "digipass";

// GET all digipass events
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
        eventType: ALLOWED_EVENT_TYPE,
    })
        .notDeleted()
        .sort({ createdAt: -1 })
        .select("_id name slug defaultLanguage logoUrl description background maxTasksPerUser minTasksPerUser formFields registrations");

    return response(res, 200, "DigiPass Events fetched successfully", {
        events,
        totalEvents: events.length,
    });
});

// GET single event by slug
exports.getEventBySlug = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const event = await Event.findOne({ slug, eventType: ALLOWED_EVENT_TYPE })
        .notDeleted()
        .select("_id name slug defaultLanguage logoUrl description background maxTasksPerUser minTasksPerUser formFields registrations");

    if (!event) {
        return response(res, 404, "DigiPass event not found");
    }

    return response(res, 200, "Event fetched successfully", event);
});

// GET single event by ID
exports.getEventById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return response(res, 400, "Invalid Event ID");
    }

    const event = await Event.findById(id)
        .notDeleted()
        .select("_id name slug defaultLanguage logoUrl description background maxTasksPerUser minTasksPerUser formFields registrations");

    if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 404, "DigiPass event not found");
    }

    return response(res, 200, "Event fetched successfully", event);
});

// CREATE digipass event
exports.createEvent = asyncHandler(async (req, res) => {
    const {
        name,
        slug,
        businessSlug,
        description,
        defaultLanguage,
        logoUrl,
        background,
        maxTasksPerUser,
        minTasksPerUser,
        formFields,
    } = req.body;

    if (!name || !slug || !businessSlug) {
        return response(res, 400, "Missing required fields: name, slug, businessSlug");
    }

    const business = await Business.findOne({ slug: businessSlug }).notDeleted();
    if (!business) {
        return response(res, 404, "Business not found");
    }

    const businessId = business._id;
    const uniqueSlug = await generateUniqueSlug(Event, "slug", slug);

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
                    identity: field.identity === true,
                }));
            }
        } catch (err) {
            console.error("Invalid formFields:", err);
            return response(res, 400, "Invalid format for formFields");
        }
    }

    if (maxTasksPerUser !== undefined && maxTasksPerUser !== null) {
        if (isNaN(Number(maxTasksPerUser)) || Number(maxTasksPerUser) < 0) {
            return response(res, 400, "maxTasksPerUser must be a non-negative number");
        }
    }

    if (minTasksPerUser !== undefined && minTasksPerUser !== null) {
        if (isNaN(Number(minTasksPerUser)) || Number(minTasksPerUser) < 0) {
            return response(res, 400, "minTasksPerUser must be a non-negative number");
        }
    }

    if (
        maxTasksPerUser !== undefined &&
        minTasksPerUser !== undefined &&
        maxTasksPerUser !== null &&
        minTasksPerUser !== null &&
        Number(maxTasksPerUser) < Number(minTasksPerUser)
    ) {
        return response(
            res,
            400,
            "maxTasksPerUser must be greater than or equal to minTasksPerUser"
        );
    }

    const newEvent = await Event.create({
        name,
        slug: uniqueSlug,
        businessId,
        eventType: ALLOWED_EVENT_TYPE,
        description: description || null,
        defaultLanguage: defaultLanguage || "en",
        logoUrl: logoUrl || null,
        ...(Object.keys(parsedBackground).length > 0
            ? { background: parsedBackground }
            : {}),
        maxTasksPerUser: maxTasksPerUser !== undefined && maxTasksPerUser !== null ? Number(maxTasksPerUser) : null,
        minTasksPerUser: minTasksPerUser !== undefined && minTasksPerUser !== null ? Number(minTasksPerUser) : null,
        formFields: parsedFormFields,
    });

    recomputeAndEmit(businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    const eventResponse = await Event.findById(newEvent._id)
        .select("_id name slug defaultLanguage logoUrl description background maxTasksPerUser minTasksPerUser formFields registrations");

    return response(res, 201, "DigiPass event created successfully", eventResponse);
});

// UPDATE digipass event
exports.updateEvent = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
        name,
        slug,
        description,
        defaultLanguage,
        logoUrl,
        background,
        maxTasksPerUser,
        minTasksPerUser,
        formFields,
        removeLogo,
        removeBackgroundEn,
        removeBackgroundAr,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return response(res, 400, "Invalid Event ID");
    }

    const event = await Event.findById(id).notDeleted();
    if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 404, "DigiPass event not found");
    }

    if (name) event.name = name;
    if (slug) {
        const uniqueSlug = await generateUniqueSlug(Event, "slug", slug, id);
        event.slug = uniqueSlug;
    }
    if (description !== undefined) event.description = description;
    if (defaultLanguage) event.defaultLanguage = defaultLanguage;

    if (removeLogo === "true" || removeLogo === true) {
        if (event.logoUrl) {
            try {
                await deleteFromS3(event.logoUrl);
            } catch (err) {
                console.error("Failed to delete logo from S3:", err);
            }
        }
        event.logoUrl = null;
    } else if (logoUrl) {
        event.logoUrl = logoUrl;
    }

    if (removeBackgroundEn === "true" || removeBackgroundEn === true) {
        if (event.background?.en?.key) {
            try {
                await deleteFromS3(event.background.en.url);
            } catch (err) {
                console.error("Failed to delete background from S3:", err);
            }
        }
        if (event.background) {
            event.background.en = {};
        } else {
            event.background = { en: {}, ar: event.background?.ar || {} };
        }
    }

    if (removeBackgroundAr === "true" || removeBackgroundAr === true) {
        if (event.background?.ar?.key) {
            try {
                await deleteFromS3(event.background.ar.url);
            } catch (err) {
                console.error("Failed to delete background from S3:", err);
            }
        }
        if (event.background) {
            event.background.ar = {};
        } else {
            event.background = { en: event.background?.en || {}, ar: {} };
        }
    }

    if (background) {
        try {
            const parsedBackground =
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

            if (Object.keys(parsedBackground).length > 0) {
                event.background = {
                    en: parsedBackground.en || event.background?.en || {},
                    ar: parsedBackground.ar || event.background?.ar || {},
                };
            }
        } catch (err) {
            console.error("Invalid background format:", err);
            return response(res, 400, "Invalid format for background");
        }
    }

    if (maxTasksPerUser !== undefined && maxTasksPerUser !== null) {
        if (isNaN(Number(maxTasksPerUser)) || Number(maxTasksPerUser) < 0) {
            return response(res, 400, "maxTasksPerUser must be a non-negative number");
        }
        event.maxTasksPerUser = Number(maxTasksPerUser);
    } else if (maxTasksPerUser === null) {
        event.maxTasksPerUser = null;
    }

    if (minTasksPerUser !== undefined && minTasksPerUser !== null) {
        if (isNaN(Number(minTasksPerUser)) || Number(minTasksPerUser) < 0) {
            return response(res, 400, "minTasksPerUser must be a non-negative number");
        }
        event.minTasksPerUser = Number(minTasksPerUser);
    } else if (minTasksPerUser === null) {
        event.minTasksPerUser = null;
    }

    if (
        event.maxTasksPerUser !== null &&
        event.minTasksPerUser !== null &&
        event.maxTasksPerUser < event.minTasksPerUser
    ) {
        return response(
            res,
            400,
            "maxTasksPerUser must be greater than or equal to minTasksPerUser"
        );
    }

    if (formFields !== undefined) {
        try {
            const rawFields =
                typeof formFields === "string" ? JSON.parse(formFields) : formFields;
            if (Array.isArray(rawFields)) {
                event.formFields = rawFields.map((field) => ({
                    inputName: field.inputName,
                    inputType: field.inputType,
                    values:
                        ["radio", "list"].includes(field.inputType) &&
                            Array.isArray(field.values)
                            ? field.values
                            : [],
                    required: field.required === true,
                    visible: field.visible !== false,
                    identity: field.identity === true,
                }));
            } else {
                return response(res, 400, "formFields must be an array");
            }
        } catch (err) {
            console.error("Invalid formFields:", err);
            return response(res, 400, "Invalid format for formFields");
        }
    }

    await event.save();

    recomputeAndEmit(event.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    const eventResponse = await Event.findById(event._id)
        .select("_id name slug defaultLanguage logoUrl description background maxTasksPerUser minTasksPerUser formFields registrations");

    return response(res, 200, "DigiPass event updated successfully", eventResponse);
});

// DELETE digipass event
exports.deleteEvent = asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return response(res, 400, "Invalid Event ID");
    }

    const event = await Event.findById(id).notDeleted();
    if (!event || event.eventType !== ALLOWED_EVENT_TYPE) {
        return response(res, 404, "DigiPass event not found");
    }

    await event.softDelete(req.user?.id || req.user?._id);

    recomputeAndEmit(event.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "DigiPass event moved to recycle bin");
});

// Restore event
exports.restoreEvent = asyncHandler(async (req, res) => {
    const event = await Event.findOneDeleted({
        _id: req.params.id,
        eventType: ALLOWED_EVENT_TYPE,
    });
    if (!event) {
        return response(res, 404, "DigiPass event not found in trash");
    }

    await event.restore();

    recomputeAndEmit(event.businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, "DigiPass event restored successfully", event);
});

// Restore ALL events
exports.restoreAllEvents = asyncHandler(async (req, res) => {
    const events = await Event.findDeleted({ eventType: ALLOWED_EVENT_TYPE });
    if (!events.length) {
        return response(res, 404, "No DigiPass events found in trash to restore");
    }

    for (const ev of events) {
        const conflict = await Event.findOne({
            _id: { $ne: ev._id },
            slug: ev.slug,
        }).notDeleted();
        if (!conflict) {
            await ev.restore();
        }
    }

    recomputeAndEmit(null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(res, 200, `Restored ${events.length} DigiPass events`);
});

// Permanent delete single event (cascade delete registrations + walk-ins)
exports.permanentDeleteEvent = asyncHandler(async (req, res) => {
    const event = await Event.findOneDeleted({
        _id: req.params.id,
        eventType: ALLOWED_EVENT_TYPE,
    });
    if (!event) {
        return response(res, 404, "DigiPass event not found in trash");
    }

    const regs = await Registration.find({ eventId: event._id });
    const regIds = regs.map((r) => r._id);

    if (regIds.length > 0) {
        await WalkIn.deleteMany({ registrationId: { $in: regIds } });
        await Registration.deleteMany({ eventId: event._id });
    }

    if (event.logoUrl) {
        try {
            await deleteFromS3(event.logoUrl);
        } catch (err) {
            console.error("Failed to delete logo from S3:", err);
        }
    }

    if (event.background?.en?.key || event.background?.en?.url) {
        try {
            await deleteFromS3(event.background.en.key || event.background.en.url);
        } catch (err) {
            console.error("Failed to delete background from S3:", err);
        }
    }

    if (event.background?.ar?.key || event.background?.ar?.url) {
        try {
            await deleteFromS3(event.background.ar.key || event.background.ar.url);
        } catch (err) {
            console.error("Failed to delete background from S3:", err);
        }
    }

    const businessId = event.businessId;
    await event.deleteOne();

    recomputeAndEmit(businessId || null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(
        res,
        200,
        "DigiPass event and its registrations permanently deleted"
    );
});

// Permanent delete ALL digipass events (cascade delete registrations + walk-ins)
exports.permanentDeleteAllEvents = asyncHandler(async (req, res) => {
    const events = await Event.findDeleted({ eventType: ALLOWED_EVENT_TYPE });
    if (!events.length) {
        return response(res, 404, "No DigiPass events found in trash to delete");
    }

    const eventIds = events.map((ev) => ev._id);

    const regs = await Registration.find({ eventId: { $in: eventIds } });
    const regIds = regs.map((r) => r._id);

    if (regIds.length > 0) {
        await WalkIn.deleteMany({ registrationId: { $in: regIds } });
        await Registration.deleteMany({ eventId: { $in: eventIds } });
    }

    for (const ev of events) {
        if (ev.logoUrl) {
            try {
                await deleteFromS3(ev.logoUrl);
            } catch (err) {
                console.error("Failed to delete logo from S3:", err);
            }
        }

        if (ev.background?.en?.key || ev.background?.en?.url) {
            try {
                await deleteFromS3(ev.background.en.key || ev.background.en.url);
            } catch (err) {
                console.error("Failed to delete background from S3:", err);
            }
        }

        if (ev.background?.ar?.key || ev.background?.ar?.url) {
            try {
                await deleteFromS3(ev.background.ar.key || ev.background.ar.url);
            } catch (err) {
                console.error("Failed to delete background from S3:", err);
            }
        }
    }

    const result = await Event.deleteMany({ _id: { $in: eventIds } });

    recomputeAndEmit(null).catch((err) =>
        console.error("Background recompute failed:", err.message)
    );

    return response(
        res,
        200,
        `Permanently deleted ${result.deletedCount} DigiPass events and their registrations`
    );
});

