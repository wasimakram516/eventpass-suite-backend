const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();

const participantController = require("../../controllers/EventWheel/spinWheelParticipantController");
const { protect, checkPermission } = require("../../middlewares/auth");

const spinWheelAccess = [protect, checkPermission.eventwheel];

// Get Participants for a SpinWheel by Slug (public - only visible participants)
router.get("/slug/:slug", participantController.getParticipantsBySlug);

// Get Participants for CMS (all participants with pagination and winner status)
router.get("/cms/:spinWheelId", spinWheelAccess, participantController.getParticipantsForCMS);

// Get Single Participant by ID
router.get("/single/:id", spinWheelAccess, participantController.getParticipantById);

// Get SpinWheel filters
router.get("/sync/filters/:spinWheelId", spinWheelAccess, participantController.getSpinWheelSyncFilters);

// Export Participants to XLSX
router.get("/export/:spinWheelId/xlsx", spinWheelAccess, participantController.exportSpinWheelParticipantsXlsx);

// Download sample Excel template (Only for "admin" SpinWheels)
router.get("/sample/:spinWheelId", spinWheelAccess, participantController.downloadSampleExcel);

// Download country reference Excel file
router.get("/country-reference", spinWheelAccess, participantController.downloadCountryReference);

// Upload Participants from Excel file (Only for "admin" SpinWheels)
router.post("/upload/:spinWheelId", spinWheelAccess, upload.single("file"), participantController.uploadParticipants);

// Admin/Business Adds Participant (Only for "admin" SpinWheels)
router.post("/", spinWheelAccess, participantController.addParticipant);

// Add Participants on the Spot (for onspot type)
router.post("/onspot", participantController.addParticipantsOnSpot);

// Sync Participants from Event Registrations (for synced type)
router.post("/sync/:spinWheelId", spinWheelAccess, participantController.syncSpinWheelParticipants);

// Update Participant
router.put("/:id", spinWheelAccess, participantController.updateParticipant);

// Delete Participant
router.delete("/:id", spinWheelAccess, participantController.deleteParticipant);

// Save Winner (public - accessible from spin wheel page)
router.post("/winner", participantController.saveWinner);

// Remove Winner (set visible to false - public)
router.put("/winner/remove/:participantId", participantController.removeWinner);

// Get Winners for a SpinWheel by Slug (public)
router.get("/winners/:slug", participantController.getWinners);

module.exports = router;
