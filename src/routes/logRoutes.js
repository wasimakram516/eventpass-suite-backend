const express = require("express");
const router = express.Router();
const { getLogs, getLogStats, exportLogs } = require("../controllers/common/logController");
const { protect, superAdminOnly } = require("../middlewares/auth");

router.get("/stats", protect, superAdminOnly, getLogStats);
router.get("/export", protect, superAdminOnly, exportLogs);
router.get("/", protect, superAdminOnly, getLogs);

module.exports = router;