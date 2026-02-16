const express = require("express");
const router = express.Router();
const { getLogs, getLogStats } = require("../controllers/common/logController");
const { protect, superAdminOnly } = require("../middlewares/auth");

router.get("/stats", protect, superAdminOnly, getLogStats);
router.get("/", protect, superAdminOnly, getLogs);

module.exports = router;