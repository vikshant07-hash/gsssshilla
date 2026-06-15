const express = require("express");
const router = express.Router();
const multer = require("multer");
const db = require("../config/db");

/* ================= MULTER ================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
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

    const file = req.file.filename;

    const sql = `
      INSERT INTO downloads (\`class\`, year, category, title, file)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [cls, year, category, title, file], (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json(err);
      }

      res.json({ message: "Added Successfully", id: result.insertId });
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= GET WITH FILTER (FIXED) ================= */
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
  db.query("DELETE FROM downloads WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Delete Failed" });
    }

    res.json({ message: "Deleted Successfully" });
  });
});



router.get("/", (req, res) => {

  const { class: cls, year, category } = req.query;

  // 🔴 ALL REQUIRED CHECK
  if (!cls || !year || !category) {
    return res.status(400).json({
      message: "Class, Year and Category are required"
    });
  }

  let sql = "SELECT * FROM downloads WHERE `class` = ? AND year = ? AND category = ?";
  let values = [cls, year, category];

  db.query(sql, values, (err, result) => {
    if (err) {
      return res.status(500).json(err);
    }
    res.json(result);
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