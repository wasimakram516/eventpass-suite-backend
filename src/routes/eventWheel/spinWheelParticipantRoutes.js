const express = require("express");
const router = express.Router();

const participantController = require("../../controllers/EventWheel/spinWheelParticipantController");
const { protect, checkPermission } = require("../../middlewares/auth");

const spinWheelAccess = [protect, checkPermission.eventwheel];

// Public Route for SpinWheel Details
router.get("/public/spinwheel/:id", participantController.getPublicSpinWheel);

// Admin/Business Adds Participant (Only for "collect_info" SpinWheels)
router.post("/", spinWheelAccess, participantController.addParticipant);

// Add or Replace Participants in Bulk (for enter_names type)
router.post("/bulk", participantController.addOrUpdateParticipantsInBulk);

// Get Participants names (bulk) by Slug
router.get("/bulk/:slug", participantController.getBulkParticipantsForSpinWheel);

// Get All Participants for a SpinWheel by ID
router.get("/:spinWheelId", spinWheelAccess, participantController.getParticipants);

// Get Participants for a SpinWheel by Slug
router.get("/slug/:slug", participantController.getParticipantsBySlug);

// Get Single Participant by ID
router.get("/single/:id", spinWheelAccess, participantController.getParticipantById);

// Update Participant
router.put("/:id", spinWheelAccess, participantController.updateParticipant);

// Delete Participant
router.delete("/:id", spinWheelAccess, participantController.deleteParticipant);

module.exports = router;
