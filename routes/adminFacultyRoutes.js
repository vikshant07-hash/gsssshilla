const router = require("express").Router();
const c = require("../controllers/adminFacultyController");
const verifyToken = require("../middleware/authMiddleware");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

/* ================= CLOUDINARY STORAGE ================= */

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "faculty",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

const upload = multer({ storage });

router.post(
  "/add",
  verifyToken,
  upload.single("photo"),
  c.add
);

router.put(
  "/update/:id",
  verifyToken,
  upload.single("photo"),   // photo update bhi optional support karega
  c.update
);

router.delete(
  "/delete/:id",
  verifyToken,
  c.remove
);

module.exports = router;