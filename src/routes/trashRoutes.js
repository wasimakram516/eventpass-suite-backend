const express = require("express");
const router = express.Router();
const tc = require("../controllers/trashController");
const { protect } = require("../middlewares/auth");

router.get("/", protect, tc.getTrash);
router.put("/:module/:id/restore", protect, tc.restoreItem);
router.delete("/:module/:id/permanent", protect, tc.permanentDeleteItem);

module.exports = router;
