const express = require("express");
const router = express.Router();

const multer = require("multer");
const db = require("../config/db");

/* ================= FILE UPLOAD ================= */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

/* ================= ADD NOTIFICATION ================= */

router.post("/add", upload.single("file"), (req, res) => {

  const { title, message, type, isImportant } = req.body;

  if (!title || !message) {
    return res.status(400).json({
      success: false,
      message: "Title and Message required"
    });
  }

  const file = req.file ? req.file.filename : null;

  db.query(
    `INSERT INTO notifications
    (title, message, file, type, isImportant)
    VALUES (?,?,?,?,?)`,
    [
      title,
      message,
      file,
      type || "general",
      isImportant || 0
    ],
    (err, result) => {

      if (err) {
        console.log(err);
        return res.status(500).json({
          success: false,
          error: err
        });
      }

      res.json({
        success: true,
        message: "Notification Added",
        id: result.insertId
      });

    }
  );
});

/* ================= GET ALL ================= */

router.get("/", (req, res) => {

  db.query(
    "SELECT * FROM notifications ORDER BY id DESC",
    (err, result) => {

      if (err) {
        return res.status(500).json(err);
      }

      res.json(result);

    }
  );

});

/* ================= IMPORTANT ONLY ================= */

router.get("/important", (req, res) => {

  db.query(
    "SELECT * FROM notifications WHERE isImportant=1 ORDER BY id DESC",
    (err, result) => {

      if (err) return res.status(500).json(err);

      res.json(result);

    }
  );

});

/* ================= SINGLE ================= */

router.get("/:id", (req, res) => {

  db.query(
    "SELECT * FROM notifications WHERE id=?",
    [req.params.id],
    (err, result) => {

      if (err) return res.status(500).json(err);

      res.json(result[0]);

    }
  );

});

/* ================= DELETE ================= */

router.delete("/:id", (req, res) => {

  db.query(
    "DELETE FROM notifications WHERE id=?",
    [req.params.id],
    (err) => {

      if (err) {
        return res.status(500).json(err);
      }

      res.json({
        success: true,
        message: "Deleted"
      });

    }
  );

});




module.exports = router;