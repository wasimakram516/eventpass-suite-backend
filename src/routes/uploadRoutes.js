const express = require("express");
const { optionalProtect } = require("../middlewares/auth");
const { authorizeUpload } = require("../controllers/uploadController");

const router = express.Router();

router.post("/authorize", optionalProtect, authorizeUpload);

module.exports = router;
