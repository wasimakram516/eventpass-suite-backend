const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const {
  getEventDetails,
  getEventById,
  getEventBySlug,
  createEvent,
  updateEvent,
  deleteEvent,
} = require("../../controllers/EventReg/eventController");
const {protect,checkPermission} = require("../../middlewares/auth");
const upload = require("../../middlewares/uploadMiddleware");
const template = "../../templates/employee_template.csv";

const eventRegAccess = [protect, checkPermission.eventreg];
const checkInAccess = [protect, checkPermission.checkin];

router.get("/download-template", (req, res) => {
  const filePath = path.join(__dirname, template);
  res.download(filePath, "employee_template.csv", (err) => {
    if (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Failed to download template." });
    }
  });
});

// Get all events for the logged-in admin
router.get("/", eventRegAccess, getEventDetails);

// Get a single event by slug
router.get("/slug/:slug", getEventBySlug); 

// Get a single event by ID
router.get("/:id", getEventById);

// Create event
router.post("/", eventRegAccess, upload.single("logo"), createEvent);

// Update event
router.put("/:id", eventRegAccess, upload.single("logo"), updateEvent);

// Delete an event
router.delete("/:id", eventRegAccess, deleteEvent);

module.exports = router;
