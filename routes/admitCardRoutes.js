const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ==================== CLOUDINARY ====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==================== MULTER (admit card PDF upload) ====================
const admitStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    return {
      folder: process.env.CLOUDINARY_ADMIT_FOLDER || "school/admit_cards",
      resource_type: "raw",
      allowed_formats: ["pdf"],
      public_id: `admit-${uniqueSuffix}`
    };
  }
});

const uploadAdmit = multer({
  storage: admitStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files allowed"));
  }
});

// ==================== AUTH ====================
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized - admin token required" });
  }
  next();
};

// ==================== ENSURE TABLES ====================
(async () => {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS admit_card_publishes (
        id INT NOT NULL AUTO_INCREMENT,
        examination_type VARCHAR(100) NOT NULL,
        exam_session VARCHAR(30) NOT NULL,
        class VARCHAR(10) NOT NULL,
        stream VARCHAR(50) DEFAULT 'Non-Specialized',
        admit_pdf_url VARCHAR(500) DEFAULT NULL,
        admit_pdf_public_id VARCHAR(255) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        is_published TINYINT(1) DEFAULT 0,
        published_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_class (class),
        KEY idx_session (exam_session),
        KEY idx_published (is_published)
      )
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS admit_card_students (
        id INT NOT NULL AUTO_INCREMENT,
        admit_publish_id INT NOT NULL,
        student_id VARCHAR(40) NOT NULL,
        roll_number VARCHAR(30) DEFAULT NULL,
        is_enabled TINYINT(1) DEFAULT 0,
        published_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_publish_student (admit_publish_id, student_id),
        KEY idx_student (student_id),
        KEY idx_publish (admit_publish_id)
      )
    `);

    console.log("✅ Admit card tables ready");
  } catch (err) {
    console.error("❌ Admit card table error:", err.message);
  }
})();

// ==================== HELPERS ====================
const fetchImageBuffer = (url) => new Promise((resolve) => {
  if (!url) return resolve(null);
  const client = url.startsWith("https") ? https : http;
  client.get(url, (resp) => {
    if (resp.statusCode !== 200) return resolve(null);
    const chunks = [];
    resp.on("data", (c) => chunks.push(c));
    resp.on("end", () => resolve(Buffer.concat(chunks)));
  }).on("error", () => resolve(null));
});

const formatDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// ============================================================
// GET CLASS STUDENTS — auto-fetch from Nstudent
// ============================================================
router.get("/class-students", requireAdmin, async (req, res) => {
  try {
    const { class: cls, session } = req.query;
    if (!cls) return res.status(400).json({ success: false, message: "class required" });

    const where = ["class = ?", "status = 'Active'"];
    const params = [cls];
    if (session) { where.push("session = ?"); params.push(session); }

    const rows = await q(
      `SELECT id, student_id, admission_number, name, father_name, mother_name,
              roll_number, class, stream, session, gender, category,
              dob, aadhar_number, apaar_id, mobile_number, email_id,
              student_photo_url, village, post_office, tehsil, district, state, pincode, address
       FROM Nstudent
       WHERE ${where.join(" AND ")}
       ORDER BY CAST(roll_number AS UNSIGNED) ASC, name ASC`,
      params
    );

    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    console.error("❌ class-students error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// CREATE — insert admit card publish with PDF
// ============================================================
router.post("/create", requireAdmin, uploadAdmit.single("admitPdf"), async (req, res) => {
  try {
    const { examinationType, examSession, class: cls, stream, notes } = req.body;

    if (!examinationType || !examSession || !cls) {
      return res.status(400).json({ success: false, message: "Examination type, session and class required" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Admit card PDF file required" });
    }

    const streamVal = ["11","12"].includes(String(cls)) ? (stream || "Science") : "Non-Specialized";

    const result = await q(
      `INSERT INTO admit_card_publishes 
       (examination_type, exam_session, class, stream, admit_pdf_url, admit_pdf_public_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [examinationType, examSession, cls, streamVal, req.file.path, req.file.filename, notes || null]
    );

    const rows = await q("SELECT * FROM admit_card_publishes WHERE id = ?", [result.insertId]);

    res.status(201).json({
      success: true,
      message: "Admit card record created ✅",
      data: rows[0]
    });
  } catch (err) {
    console.error("❌ create admit error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// LIST — all admit card publishes (admin)
// ============================================================
router.get("/list", requireAdmin, async (req, res) => {
  try {
    const { class: cls, session } = req.query;
    const where = [];
    const params = [];
    if (cls) { where.push("class = ?"); params.push(cls); }
    if (session) { where.push("exam_session = ?"); params.push(session); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await q(
      `SELECT p.*, 
        (SELECT COUNT(*) FROM admit_card_students WHERE admit_publish_id = p.id) as total_students,
        (SELECT COUNT(*) FROM admit_card_students WHERE admit_publish_id = p.id AND is_enabled = 1) as published_count
       FROM admit_card_publishes p
       ${whereSql}
       ORDER BY p.created_at DESC`,
      params
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GET SINGLE — with all students
// ============================================================
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await q("SELECT * FROM admit_card_publishes WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

    const students = await q(
      `SELECT acs.*, s.name, s.class, s.student_photo_url, s.father_name, s.gender, s.category
       FROM admit_card_students acs
       JOIN Nstudent s ON s.student_id = acs.student_id
       WHERE acs.admit_publish_id = ?
       ORDER BY CAST(acs.roll_number AS UNSIGNED) ASC, s.name ASC`,
      [id]
    );

    res.json({ success: true, data: rows[0], students });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// DELETE — remove admit publish + Cloudinary file + students
// ============================================================
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await q("SELECT * FROM admit_card_publishes WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

    const item = rows[0];
    if (item.admit_pdf_public_id) {
      try {
        await cloudinary.uploader.destroy(item.admit_pdf_public_id, { resource_type: "raw" });
      } catch (e) { console.warn("Cloudinary delete warning:", e.message); }
    }

    await q("DELETE FROM admit_card_students WHERE admit_publish_id = ?", [id]);
    await q("DELETE FROM admit_card_publishes WHERE id = ?", [id]);

    res.json({ success: true, message: "Deleted ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PUBLISH — bulk (class) or selected student IDs
// ============================================================
router.post("/:id/publish", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { studentIds } = req.body || {};

    const publishRows = await q("SELECT * FROM admit_card_publishes WHERE id = ?", [id]);
    if (!publishRows.length) return res.status(404).json({ success: false, message: "Not found" });
    const publish = publishRows[0];

    let students;
    if (Array.isArray(studentIds) && studentIds.length) {
      const ph = studentIds.map(() => "?").join(",");
      students = await q(
        `SELECT student_id, roll_number FROM Nstudent WHERE student_id IN (${ph})`,
        studentIds
      );
    } else {
      students = await q(
        `SELECT student_id, roll_number FROM Nstudent 
         WHERE class = ? AND status = 'Active'`,
        [publish.class]
      );
    }

    if (!students.length) {
      return res.status(400).json({ success: false, message: "No students found" });
    }

    let count = 0;
    for (const s of students) {
      await q(
        `INSERT INTO admit_card_students (admit_publish_id, student_id, roll_number, is_enabled, published_at)
         VALUES (?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE is_enabled = 1, published_at = NOW()`,
        [id, s.student_id, s.roll_number]
      );
      count++;
    }

    const isPublishingAll = !Array.isArray(studentIds) || studentIds.length === 0;
    if (isPublishingAll) {
      await q("UPDATE admit_card_publishes SET is_published = 1, published_at = NOW() WHERE id = ?", [id]);
    }

    res.json({
      success: true,
      message: `Admit cards published for ${count} student(s) ✅`,
      count
    });
  } catch (err) {
    console.error("❌ publish error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// UNPUBLISH
// ============================================================
router.post("/:id/unpublish", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { studentIds } = req.body || {};

    if (Array.isArray(studentIds) && studentIds.length) {
      const ph = studentIds.map(() => "?").join(",");
      await q(
        `UPDATE admit_card_students SET is_enabled = 0 WHERE admit_publish_id = ? AND student_id IN (${ph})`,
        [id, ...studentIds]
      );
      return res.json({ success: true, message: "Unpublished for selected students ✅" });
    }

    await q("UPDATE admit_card_students SET is_enabled = 0 WHERE admit_publish_id = ?", [id]);
    await q("UPDATE admit_card_publishes SET is_published = 0 WHERE id = ?", [id]);
    res.json({ success: true, message: "Unpublished ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — get own published admit cards (public)
// ============================================================
router.get("/student/:studentId/list", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q(
      `SELECT acs.id as student_row_id, acs.roll_number, acs.published_at,
              p.id as publish_id, p.examination_type, p.exam_session, p.class, p.stream,
              p.admit_pdf_url, p.notes
       FROM admit_card_students acs
       JOIN admit_card_publishes p ON p.id = acs.admit_publish_id
       WHERE acs.student_id = ? AND acs.is_enabled = 1
       ORDER BY acs.published_at DESC`,
      [studentId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — open admit PDF (public, only if enabled for them)
// ============================================================
router.get("/student/:studentId/pdf/:publishId", async (req, res) => {
  try {
    const { studentId, publishId } = req.params;

    const check = await q(
      `SELECT * FROM admit_card_students WHERE admit_publish_id = ? AND student_id = ? AND is_enabled = 1`,
      [publishId, studentId]
    );
    if (!check.length) {
      return res.status(403).json({ success: false, message: "Admit card not available for you" });
    }

    const p = await q("SELECT * FROM admit_card_publishes WHERE id = ?", [publishId]);
    if (!p.length) return res.status(404).json({ success: false, message: "Not found" });

    const pdfUrl = p[0].admit_pdf_url;
    if (!pdfUrl) return res.status(404).json({ success: false, message: "PDF not uploaded" });

    res.redirect(pdfUrl);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
