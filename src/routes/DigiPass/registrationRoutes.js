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

const digiPassAccess = [protect, checkPermission.digipass];

// Create registration: public (no auth) or CMS (token optional — sets createdBy when present)
router.post("/", optionalProtect, createRegistration);

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
router.put("/:id", digiPassAccess, updateRegistration);

// Delete registration
router.delete("/:id", digiPassAccess, deleteRegistration);

// Create walkin record for a registration (protected)
router.post("/:id/walkin", digiPassAccess, createWalkIn);

module.exports = router;

