const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const {
    createRegistration,
    getRegistrationsByEvent,
    getAllPublicRegistrationsByEvent,
    getRegistrationById,
    updateRegistration,
    deleteRegistration,
    verifyRegistrationByToken,
    createWalkIn,
    downloadSampleExcel,
    uploadRegistrations,
    exportRegistrations,
    signIn,
} = require("../../controllers/DigiPass/registrationController");

const { protect, optionalProtect, checkPermission } = require("../../middlewares/auth");
const activityLogger = require("../../middlewares/activityLogger");
const Registration = require("../../models/Registration");
const Event = require("../../models/Event");

const digiPassAccess = [protect];

const preFetchRegistrationBusinessId = async (req) => {
    const reg = await Registration.findById(req.params.id).select("eventId").lean();
    if (!reg?.eventId) return null;
    const event = await Event.findById(reg.eventId).select("businessId").lean();
    return event?.businessId ?? null;
};

const preFetchCreateRegBusinessId = async (req) => {
    const eventId = req.body?.eventId;
    if (eventId) {
        const event = await Event.findById(eventId).select("businessId").lean();
        return event?.businessId ?? null;
    }
    const slug = req.body?.eventSlug ?? req.body?.slug;
    if (slug) {
        const event = await Event.findOne({ slug, eventType: "digipass" }).select("businessId").lean();
        return event?.businessId ?? null;
    }
    return null;
};

// Create registration: public (no auth) or CMS (token optional — sets createdBy when present)
router.post(
    "/",
    optionalProtect,
    activityLogger({
        logType: "create",
        itemType: "Registration",
        module: "DigiPass",
        preFetchBusinessId: preFetchCreateRegBusinessId,
    }),
    createRegistration,
);

// Sign in using identity fields (public - no auth required)
router.post("/signin", signIn);

// Verify registration via QR token (protected - staff) (must be before /:id route)
router.get("/verify", digiPassAccess, verifyRegistrationByToken);

// Get paginated registrations for a specific event (protected)
router.get("/event/:slug", digiPassAccess, getRegistrationsByEvent);

// GET initial registrations (first 50) - triggers background loading
router.get("/event/:slug/all", digiPassAccess, getAllPublicRegistrationsByEvent);

// Download sample Excel file
router.get("/event/:slug/sample-excel", digiPassAccess, downloadSampleExcel);

// Upload registrations from Excel file
router.post("/event/:slug/upload", digiPassAccess, upload.single("file"), uploadRegistrations);

// Export registrations to CSV
router.get("/event/:slug/export", digiPassAccess, exportRegistrations);

// Get single registration by ID (must be after all specific routes)
router.get("/:id", digiPassAccess, getRegistrationById);

// Update registration
router.put(
    "/:id",
    digiPassAccess,
    activityLogger({
        logType: "update",
        itemType: "Registration",
        module: "DigiPass",
        getItemId: (req) => req.params.id,
        preFetchBusinessId: preFetchRegistrationBusinessId,
    }),
    updateRegistration,
);

// Delete registration
router.delete(
    "/:id",
    digiPassAccess,
    activityLogger({
        logType: "delete",
        itemType: "Registration",
        module: "DigiPass",
        getItemId: (req) => req.params.id,
        preFetchBusinessId: preFetchRegistrationBusinessId,
    }),
    deleteRegistration,
);

// Create walkin record for a registration (protected)
router.post(
    "/:id/walkin",
    digiPassAccess,
    activityLogger({
        logType: "create",
        itemType: "Registration",
        module: "DigiPass",
        getItemId: (req) => req.params.id,
        preFetchBusinessId: preFetchRegistrationBusinessId,
    }),
    createWalkIn,
);

module.exports = router;

