// routes/translateRoutes.js
const express = require("express");
const { translateText } = require("../controllers/translateController");

const router = express.Router();

router.post("/", translateText);

module.exports = router;
