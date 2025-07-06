const express = require("express");
const router = express.Router();
const controller = require("../controllers/globalConfigController");
const { protect, adminOnly } = require("../middlewares/auth");
const multer = require("../middlewares/uploadMiddleware");

const multiUpload = multer.fields([
  { name: "companyLogo", maxCount: 1 },
  { name: "brandingMedia", maxCount: 1 },
  { name: "poweredByMedia", maxCount: 1 }
]);

router.post("/", protect, adminOnly, multiUpload, controller.createConfig);
router.get("/", controller.getConfig);
router.put("/", protect, adminOnly, multiUpload, controller.updateConfig);
router.delete("/", protect, adminOnly, controller.deleteConfig);

module.exports = router;
