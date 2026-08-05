const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadRecent");
const recent = require("../controllers/recentController");

// ==================== PUBLIC ROUTES ====================
router.get("/", recent.getUpdates);
router.get("/recent", recent.getRecentUpdates);
router.get("/:id", recent.getUpdateById);
router.get("/category/:category", recent.getUpdatesByCategory);
router.get("/search/:query", recent.searchUpdates);

// ==================== ADMIN ROUTES ====================
router.post("/", verifyToken, upload.single("file"), recent.addUpdate);
router.put("/:id", verifyToken, upload.single("file"), recent.updateUpdate);
router.delete("/:id", verifyToken, recent.deleteUpdate);

module.exports = router;
