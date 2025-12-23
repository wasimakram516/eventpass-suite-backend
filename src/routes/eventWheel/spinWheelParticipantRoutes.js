const express = require("express");
const router = express.Router();

const participantController = require("../../controllers/EventWheel/spinWheelParticipantController");
const { protect, checkPermission } = require("../../middlewares/auth");

const spinWheelAccess = [protect, checkPermission.eventwheel];

// Get Participants for a SpinWheel by Slug
router.get("/slug/:slug", participantController.getParticipantsBySlug);

// Get Single Participant by ID
router.get("/single/:id", spinWheelAccess, participantController.getParticipantById);

// Get SpinWheel filters
router.get("/sync/filters/:spinWheelId", spinWheelAccess, participantController.getSpinWheelSyncFilters);

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

module.exports = router;
