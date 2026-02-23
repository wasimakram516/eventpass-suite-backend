const express = require("express");
const router = express.Router();
const { globalSearch } = require("../controllers/common/globalSearchController");
const { protect, superAdminOnly } = require("../middlewares/auth");

router.get("/", protect, superAdminOnly, globalSearch);
router.post("/", protect, superAdminOnly, globalSearch);

module.exports = router;
