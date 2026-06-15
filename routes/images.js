const express = require("express");
const router = express.Router();
const multer = require("multer");
const db = require("../config/db");
const auth = require("../middleware/auth");

/* STORAGE */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

/* UPLOAD IMAGE */
router.post("/upload", upload.single("image"), (req, res) => {

  const filename = req.file.filename;
  const caption = req.body.caption;

  db.query(
    "INSERT INTO images (filename, caption) VALUES (?, ?)",
    [filename, caption],
    (err, result) => {
      if (err) return res.status(500).json(err);

      res.json({ message: "Uploaded" });
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


router.delete("/:id", (req, res) => {

  const id = req.params.id;

  db.query("DELETE FROM images WHERE id=?", [id], (err) => {
    if (err) return res.status(500).json(err);

    res.json({ message: "Deleted" });
  });
});

module.exports = router;