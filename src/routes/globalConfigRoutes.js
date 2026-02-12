const express = require("express");
const router = express.Router();
const controller = require("../controllers/globalConfigController");
const { protect, adminOnly } = require("../middlewares/auth");
const multer = require("../middlewares/uploadMiddleware");

const multiUpload = multer.fields([
  { name: "companyLogo", maxCount: 1 },
  { name: "brandingMedia", maxCount: 1 },
  { name: "poweredByMedia", maxCount: 1 },
  { name: "clientLogos", maxCount: 20 }
]);

const qrWrapperUpload = multer.fields([
  { name: "qrWrapperLogo", maxCount: 1 },
  { name: "qrWrapperBackground", maxCount: 1 },
  { name: "qrWrapperBrandingMedia", maxCount: 20 }
]);

router.post("/", protect, adminOnly, multiUpload, controller.createConfig);
router.get("/", controller.getConfig);
router.get("/proxy-image", controller.proxyImage);
router.put("/", protect, adminOnly, multiUpload, controller.updateConfig);
router.put("/default-qr-wrapper", protect, adminOnly, qrWrapperUpload, controller.updateDefaultQrWrapper);
router.delete("/", protect, adminOnly, controller.deleteConfig);
router.post("/fonts/sync", controller.syncFonts);
router.get("/fonts", controller.getFonts);

module.exports = router;
