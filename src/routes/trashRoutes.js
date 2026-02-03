const express = require("express");
const router = express.Router();
const tc = require("../controllers/trashController");
const { protect, superAdminOnly } = require("../middlewares/auth");

router.get("/", protect, tc.getTrash);
router.get("/module-counts", protect, tc.getModuleCounts); 
router.put("/:module/:id/restore", protect, tc.restoreItem);
router.delete("/:module/:id/permanent", protect, superAdminOnly, tc.permanentDeleteItem);
router.put("/:module/restore-all", protect, tc.restoreAllItems);
router.delete("/:module/permanent-all", protect, superAdminOnly, tc.permanentDeleteAllItems);

module.exports = router;
