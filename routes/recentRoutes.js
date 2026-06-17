const express = require("express");
const router = express.Router();

const verifyToken =
require("../middleware/authMiddleware");

const upload =
require("../middleware/uploadRecent");

const recent =
require("../controllers/recentController");

/* PUBLIC */
router.get("/", recent.getUpdates);

/* ADMIN */
router.post(
  "/",
  verifyToken,
  upload.single("file"),
  recent.addUpdate
);

router.put(
  "/:id",
  verifyToken,
  upload.single("file"),
  recent.updateUpdate
);

router.delete(
  "/:id",
  verifyToken,
  recent.deleteUpdate
);

module.exports = router;