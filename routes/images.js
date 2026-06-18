const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");

/* ================= CLOUDINARY STORAGE ================= */

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "images",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

const upload = multer({ storage });

/* UPLOAD IMAGE */
router.post("/upload", upload.single("image"), (req, res) => {

  if (!req.file) {
    return res.status(400).json({ message: "Image is required" });
  }

  // ✅ Cloudinary full URL store hoga
  const filename = req.file.path;
  const caption = req.body.caption;

  db.query(
    "INSERT INTO images (filename, caption) VALUES (?, ?)",
    [filename, caption],
    (err, result) => {
      if (err) return res.status(500).json(err);

      res.json({ message: "Uploaded", file: filename });
    }
  );
});

/* GET IMAGES */
router.get("/", (req, res) => {
  db.query("SELECT * FROM images ORDER BY id DESC", (err, result) => {
    if (err) return res.status(500).json(err);

    res.json(result);
  });
});

/* DELETE */
router.delete("/:id", (req, res) => {

  const id = req.params.id;

  db.query("SELECT filename FROM images WHERE id=?", [id], async (err, rows) => {

    if (err) return res.status(500).json(err);

    if (rows.length && rows[0].filename) {
      try {
        const imageUrl = rows[0].filename;
        const publicId = imageUrl
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];

        await cloudinary.uploader.destroy(publicId);
      } catch (e) {
        console.log("Cloudinary delete error:", e);
      }
    }

    db.query("DELETE FROM images WHERE id=?", [id], (err) => {
      if (err) return res.status(500).json(err);

      res.json({ message: "Deleted" });
    });

  });

});

module.exports = router;