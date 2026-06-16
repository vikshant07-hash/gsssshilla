const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const db = require("../config/db");

/* ================= CLOUDINARY STORAGE ================= */

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "downloads",
    resource_type: "auto", // pdf + image + any file type
  },
});

const upload = multer({ storage });

/* ================= ADD FILE ================= */
router.post("/add", upload.single("pdf"), (req, res) => {
  try {
    const cls = req.body.class;
    const year = req.body.year;
    const category = req.body.category;
    const title = req.body.title;

    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }

    // ✅ Cloudinary full URL store hoga
    const file = req.file.path;

    const sql = `
      INSERT INTO downloads (\`class\`, year, category, title, file)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [cls, year, category, title, file], (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json(err);
      }

      res.json({ message: "Added Successfully", id: result.insertId, file });
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= GET WITH OPTIONAL FILTER ================= */
router.get("/", (req, res) => {

  const cls = req.query.class;
  const year = req.query.year;
  const category = req.query.category;

  let sql = "SELECT * FROM downloads WHERE 1=1";
  let values = [];

  if (cls) {
    sql += " AND `class` = ?";
    values.push(cls);
  }

  if (year) {
    sql += " AND year = ?";
    values.push(year);
  }

  if (category) {
    sql += " AND category = ?";
    values.push(category);
  }

  db.query(sql, values, (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json(err);
    }
    res.json(result);
  });
});

/* ================= DELETE ================= */
router.delete("/:id", (req, res) => {

  db.query("SELECT file FROM downloads WHERE id = ?", [req.params.id], async (err, rows) => {

    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete Failed" });
    }

    if (rows.length && rows[0].file) {
      try {
        const fileUrl = rows[0].file;
        const publicId = fileUrl
          .split("/")
          .slice(-2)
          .join("/")
          .split(".")[0];

        await cloudinary.uploader.destroy(publicId, { resource_type: "auto" });
      } catch (e) {
        console.log("Cloudinary delete error:", e);
      }
    }

    db.query("DELETE FROM downloads WHERE id = ?", [req.params.id], (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Delete Failed" });
      }

      res.json({ message: "Deleted Successfully" });
    });

  });

});

/* ================= TEACHER ACCESS ================= */
router.post("/teacher-access", (req, res) => {
  const { teacher_id, can_upload } = req.body;

  db.query(
    "INSERT INTO teacher_access (teacher_id, can_upload) VALUES (?, ?)",
    [teacher_id, can_upload],
    (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Update Failed" });
      }

      res.json({ message: "Teacher Access Updated" });
    }
  );
});

module.exports = router;