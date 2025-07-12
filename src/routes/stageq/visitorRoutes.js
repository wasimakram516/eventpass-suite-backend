const express = require("express");
const router = express.Router();
const { getAllVisitors } = require("../../controllers/stageq/visitorController");
const { protect } = require("../../middlewares/auth");

router.get("/", protect, getAllVisitors);

module.exports = router;
