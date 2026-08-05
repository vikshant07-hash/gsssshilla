const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const { uploadRecent } = require("../config/cloudinary");
const recentController = require("../controllers/recentController");

// ==================== PUBLIC ROUTES ====================
router.get("/", recentController.getUpdates);
router.get("/public", recentController.getPublicUpdates);
router.get("/recent", recentController.getRecentUpdates);
router.get("/:id", recentController.getUpdateById);

// ==================== ADMIN ROUTES ====================
router.post("/", verifyToken, uploadRecent.single("file"), recentController.addUpdate);
router.put("/:id", verifyToken, uploadRecent.single("file"), recentController.updateUpdate);
router.delete("/:id", verifyToken, recentController.deleteUpdate);
router.patch("/:id/toggle-new", verifyToken, recentController.toggleNewStatus);

module.exports = router;
