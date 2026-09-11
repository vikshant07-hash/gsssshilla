const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// AUTH — simple admin token check
// ============================================================
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  req.adminToken = auth.substring(7);
  next();
};

// ============================================================
// CREATE TABLES ON LOAD
// ============================================================
(async () => {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INT NOT NULL AUTO_INCREMENT,
        subject_name VARCHAR(150) NOT NULL,
        subject_code VARCHAR(50) NOT NULL,
        class VARCHAR(10) NOT NULL,
        stream VARCHAR(50) DEFAULT 'Non-Specialized',
        max_marks INT DEFAULT 100,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_subject_class (subject_code, class, stream)
      )
    `);
    await q(`
      CREATE TABLE IF NOT EXISTS examinations (
        id INT NOT NULL AUTO_INCREMENT,
        exam_name VARCHAR(200) NOT NULL,
        exam_type VARCHAR(80) NOT NULL,
        class VARCHAR(10) NOT NULL,
        stream VARCHAR(50) DEFAULT 'Non-Specialized',
        exam_session VARCHAR(30) NOT NULL,
        academic_session VARCHAR(30) NOT NULL,
        start_date DATE,
        end_date DATE,
        is_published TINYINT(1) DEFAULT 0,
        published_at TIMESTAMP NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )
    `);
    await q(`
      CREATE TABLE IF NOT EXISTS date_sheet (
        id INT NOT NULL AUTO_INCREMENT,
        exam_id INT NOT NULL,
        subject_id INT NOT NULL,
        exam_date DATE NOT NULL,
        start_time VARCHAR(20) NOT NULL,
        end_time VARCHAR(20) NOT NULL,
        room VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )
    `);
    await q(`
      CREATE TABLE IF NOT EXISTS admit_cards (
        id INT NOT NULL AUTO_INCREMENT,
        exam_id INT NOT NULL,
        student_id VARCHAR(40) NOT NULL,
        roll_number VARCHAR(30) DEFAULT NULL,
        is_enabled TINYINT(1) DEFAULT 1,
        published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_exam_student (exam_id, student_id)
      )
    `);
    console.log("✅ Admit card tables ready");
  } catch (err) {
    console.error("❌ Admit card table error:", err.message);
  }
})();

// ============================================================
// SUBJECTS — CRUD
// ============================================================
router.get("/subjects", requireAdmin, async (req, res) => {
  try {
    const { class: cls, stream } = req.query;
    const where = [];
    const params = [];
    if (cls) { where.push("class = ?"); params.push(cls); }
    if (stream) { where.push("stream = ?"); params.push(stream); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await q(
      `SELECT * FROM subjects ${whereSql} ORDER BY class ASC, stream ASC, subject_name ASC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/subjects", requireAdmin, async (req, res) => {
  try {
    const { subjectName, subjectCode, class: cls, stream, maxMarks } = req.body;
    if (!subjectName || !subjectCode || !cls) {
      return res.status(400).json({ success: false, message: "Name, code, class required" });
    }
    const streamVal = ["11","12"].includes(String(cls)) ? (stream || "Science") : "Non-Specialized";

    const result = await q(
      `INSERT INTO subjects (subject_name, subject_code, class, stream, max_marks)
       VALUES (?, ?, ?, ?, ?)`,
      [subjectName.trim(), subjectCode.trim().toUpperCase(), cls, streamVal, maxMarks || 100]
    );
    const rows = await q("SELECT * FROM subjects WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, message: "Subject added ✅", data: rows[0] });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ success: false, message: "Subject code already exists for this class/stream" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/subjects/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { subjectName, subjectCode, class: cls, stream, maxMarks, isActive } = req.body;

    const existing = await q("SELECT * FROM subjects WHERE id = ?", [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: "Subject not found" });

    const streamVal = ["11","12"].includes(String(cls)) ? (stream || "Science") : "Non-Specialized";

    await q(
      `UPDATE subjects SET subject_name = ?, subject_code = ?, class = ?, stream = ?, max_marks = ?, is_active = ? WHERE id = ?`,
      [subjectName, subjectCode.toUpperCase(), cls, streamVal, maxMarks || 100, isActive !== undefined ? (isActive ? 1 : 0) : 1, id]
    );
    const rows = await q("SELECT * FROM subjects WHERE id = ?", [id]);
    res.json({ success: true, message: "Subject updated ✅", data: rows[0] });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ success: false, message: "Duplicate subject code" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/subjects/:id", requireAdmin, async (req, res) => {
  try {
    await q("DELETE FROM subjects WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Subject deleted ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// EXAMINATIONS — CRUD
// ============================================================
router.get("/examinations", requireAdmin, async (req, res) => {
  try {
    const { class: cls, session, published } = req.query;
    const where = [];
    const params = [];
    if (cls) { where.push("class = ?"); params.push(cls); }
    if (session) { where.push("academic_session = ?"); params.push(session); }
    if (published === "true") where.push("is_published = 1");
    if (published === "false") where.push("is_published = 0");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await q(
      `SELECT e.*, 
        (SELECT COUNT(*) FROM date_sheet WHERE exam_id = e.id) as subjects_count
       FROM examinations e ${whereSql} ORDER BY e.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/examinations/:id", requireAdmin, async (req, res) => {
  try {
    const rows = await q("SELECT * FROM examinations WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Exam not found" });

    const ds = await q(
      `SELECT ds.*, s.subject_name, s.subject_code, s.max_marks
       FROM date_sheet ds JOIN subjects s ON s.id = ds.subject_id
       WHERE ds.exam_id = ? ORDER BY ds.exam_date ASC, ds.start_time ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows[0], datesheet: ds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/examinations", requireAdmin, async (req, res) => {
  try {
    const { examName, examType, class: cls, stream, examSession, academicSession, startDate, endDate } = req.body;
    if (!examName || !examType || !cls || !examSession || !academicSession) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    const streamVal = ["11","12"].includes(String(cls)) ? (stream || "Science") : "Non-Specialized";

    const result = await q(
      `INSERT INTO examinations (exam_name, exam_type, class, stream, exam_session, academic_session, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [examName, examType, cls, streamVal, examSession, academicSession, startDate || null, endDate || null]
    );
    const rows = await q("SELECT * FROM examinations WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, message: "Examination created ✅", data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/examinations/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { examName, examType, class: cls, stream, examSession, academicSession, startDate, endDate, isActive } = req.body;
    const existing = await q("SELECT * FROM examinations WHERE id = ?", [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: "Exam not found" });
    const streamVal = ["11","12"].includes(String(cls)) ? (stream || "Science") : "Non-Specialized";

    await q(
      `UPDATE examinations SET exam_name = ?, exam_type = ?, class = ?, stream = ?, 
       exam_session = ?, academic_session = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?`,
      [examName, examType, cls, streamVal, examSession, academicSession, startDate || null, endDate || null,
       isActive !== undefined ? (isActive ? 1 : 0) : 1, id]
    );
    const rows = await q("SELECT * FROM examinations WHERE id = ?", [id]);
    res.json({ success: true, message: "Exam updated ✅", data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/examinations/:id", requireAdmin, async (req, res) => {
  try {
    await q("DELETE FROM date_sheet WHERE exam_id = ?", [req.params.id]);
    await q("DELETE FROM admit_cards WHERE exam_id = ?", [req.params.id]);
    await q("DELETE FROM examinations WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Exam deleted (with datesheet and admit cards) ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// DATE SHEET — CRUD
// ============================================================
router.get("/examinations/:id/datesheet", requireAdmin, async (req, res) => {
  try {
    const rows = await q(
      `SELECT ds.*, s.subject_name, s.subject_code, s.max_marks
       FROM date_sheet ds JOIN subjects s ON s.id = ds.subject_id
       WHERE ds.exam_id = ? ORDER BY ds.exam_date ASC, ds.start_time ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/examinations/:id/datesheet", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { subjectId, examDate, startTime, endTime, room } = req.body;
    if (!subjectId || !examDate || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: "Subject, date, times required" });
    }

    const result = await q(
      `INSERT INTO date_sheet (exam_id, subject_id, exam_date, start_time, end_time, room)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, subjectId, examDate, startTime, endTime, room || null]
    );
    const rows = await q(
      `SELECT ds.*, s.subject_name, s.subject_code FROM date_sheet ds 
       JOIN subjects s ON s.id = ds.subject_id WHERE ds.id = ?`,
      [result.insertId]
    );
    res.status(201).json({ success: true, message: "Date sheet entry added ✅", data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/datesheet/:id", requireAdmin, async (req, res) => {
  try {
    await q("DELETE FROM date_sheet WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Removed ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PUBLISH — generate admit cards for all students of class
// ============================================================
router.post("/examinations/:id/publish", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const examRows = await q("SELECT * FROM examinations WHERE id = ?", [id]);
    if (!examRows.length) return res.status(404).json({ success: false, message: "Exam not found" });
    const exam = examRows[0];

    // Check datesheet exists
    const ds = await q("SELECT COUNT(*) as c FROM date_sheet WHERE exam_id = ?", [id]);
    if (!ds[0].c) return res.status(400).json({ success: false, message: "Add date sheet first before publishing" });

    // Get students
    const students = await q(
      `SELECT student_id, roll_number FROM Nstudent 
       WHERE class = ? AND session = ? AND status = 'Active'`,
      [exam.class, exam.academic_session]
    );

    if (!students.length) {
      return res.status(400).json({ success: false, message: "No active students found for this class/session" });
    }

    let count = 0;
    for (const s of students) {
      await q(
        `INSERT INTO admit_cards (exam_id, student_id, roll_number, is_enabled)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE is_enabled = 1, roll_number = VALUES(roll_number)`,
        [id, s.student_id, s.roll_number]
      );
      count++;
    }

    await q(
      "UPDATE examinations SET is_published = 1, published_at = NOW() WHERE id = ?",
      [id]
    );

    res.json({
      success: true,
      message: `Admit cards published for ${count} students ✅`,
      count,
      exam
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/examinations/:id/unpublish", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await q("UPDATE examinations SET is_published = 0 WHERE id = ?", [id]);
    await q("UPDATE admit_cards SET is_enabled = 0 WHERE exam_id = ?", [id]);
    res.json({ success: true, message: "Exam unpublished ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// LIST PUBLISHED EXAMS FOR A STUDENT (student portal)
// ============================================================
router.get("/student/:studentId/exams", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q(
      `SELECT ac.id as admit_id, ac.roll_number, ac.is_enabled,
        e.id as exam_id, e.exam_name, e.exam_type, e.class, e.exam_session, e.academic_session,
        e.start_date, e.end_date, e.is_published
       FROM admit_cards ac
       JOIN examinations e ON e.id = ac.exam_id
       WHERE ac.student_id = ? AND ac.is_enabled = 1 AND e.is_published = 1
       ORDER BY e.created_at DESC`,
      [studentId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIT CARD PDF — public (student downloads)
// ============================================================
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

router.get("/admit/:examId/:studentId/pdf", async (req, res) => {
  try {
    const { examId, studentId } = req.params;

    const examRows = await q("SELECT * FROM examinations WHERE id = ?", [examId]);
    if (!examRows.length) return res.status(404).json({ success: false, message: "Exam not found" });
    const exam = examRows[0];

    if (!exam.is_published) {
      return res.status(403).json({ success: false, message: "Admit cards not published yet" });
    }

    const acRows = await q(
      "SELECT * FROM admit_cards WHERE exam_id = ? AND student_id = ? AND is_enabled = 1",
      [examId, studentId]
    );
    if (!acRows.length) {
      return res.status(403).json({ success: false, message: "Admit card not available for this student" });
    }
    const admit = acRows[0];

    const sRows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!sRows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = sRows[0];

    const ds = await q(
      `SELECT ds.*, sub.subject_name, sub.subject_code, sub.max_marks
       FROM date_sheet ds JOIN subjects sub ON sub.id = ds.subject_id
       WHERE ds.exam_id = ? ORDER BY ds.exam_date ASC, ds.start_time ASC`,
      [examId]
    );

    // Build PDF
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="admit-${studentId}-${examId}.pdf"`);
    doc.pipe(res);

    // ==================== HEADER ====================
    doc.rect(0, 0, doc.page.width, 100).fill("#0d1b2a");
    doc.rect(0, 100, doc.page.width, 5).fill("#c9972b");

    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    if (logoBuf) {
      try { doc.image(logoBuf, 40, 18, { width: 65, height: 65 }); } catch (e) {}
    }

    doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold")
      .text("Govt. Sr. Sec. School Shilla", 120, 25, { align: "center", width: doc.page.width - 240 });
    doc.fontSize(10).font("Helvetica")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", 120, 55, { align: "center", width: doc.page.width - 240 });
    doc.fontSize(10).fillColor("#c9972b").font("Helvetica-Bold")
      .text("ADMIT CARD", 120, 75, { align: "center", width: doc.page.width - 240, characterSpacing: 4 });

    doc.fillColor("#000000");
    doc.y = 130;

    // Exam info bar
    doc.rect(40, 130, doc.page.width - 80, 50).fillAndStroke("#fef8ed", "#c9972b");
    doc.fillColor("#0d1b2a").font("Helvetica-Bold").fontSize(13)
      .text(exam.exam_name, 50, 138, { width: doc.page.width - 100, align: "center" });
    doc.fontSize(9).fillColor("#5a6a7e").font("Helvetica")
      .text(`Exam Type: ${exam.exam_type}  |  Exam Session: ${exam.exam_session}  |  Class: ${exam.class}${["11","12"].includes(String(exam.class)) ? " · " + exam.stream : ""}`, 50, 158, { width: doc.page.width - 100, align: "center" });

    doc.y = 200;

    // PHOTO
    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const px = doc.page.width - 140;
    const py = 200;

    if (photoBuf) {
      try {
        doc.rect(px - 4, py - 4, 88, 108).strokeColor("#c9972b").lineWidth(2).stroke();
        doc.image(photoBuf, px, py, { width: 80, height: 100 });
      } catch (e) {}
    } else {
      doc.rect(px, py, 80, 100).strokeColor("#c9972b").lineWidth(2).stroke();
      doc.fontSize(9).fillColor("#94a3b8").text("Photo", px + 25, py + 45);
    }

    // STUDENT INFO
    const row = (label, value, x, y) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#c9972b").text(`${label}:`, x, y);
      doc.font("Helvetica").fontSize(10.5).fillColor("#1a2332").text(String(value ?? "—"), x + 85, y);
    };

    row("Student Name", s.name, 40, 205);
    row("Student ID", s.student_id, 40, 225);
    row("Father's Name", s.father_name, 40, 245);
    row("Class & Section", s.class, 40, 265);
    row("Academic Session", exam.academic_session, 40, 285);
    row("Date of Birth", s.dob, 40, 305);
    row("Roll Number", admit.roll_number || s.roll_number || "—", 300, 205);
    row("Aadhar Number", s.aadhar_number, 300, 225);
    row("Gender", s.gender, 300, 245);
    row("Category", s.category, 300, 265);
    row("APAAR ID", s.apaar_id, 300, 285);
    row("Stream", (["11","12"].includes(String(s.class)) ? (s.stream || "—") : "Non-Specialized"), 300, 305);

    // DATE SHEET TABLE
    doc.y = 350;
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a")
      .text("EXAMINATION SCHEDULE", 40, 350, { width: doc.page.width - 80 });
    doc.rect(40, 368, doc.page.width - 80, 2).fill("#c9972b");

    let tableY = 380;
    const colX = [45, 90, 300, 400, 500];
    const colW = [45, 210, 100, 100, 100];

    // Header
    doc.rect(40, tableY, doc.page.width - 80, 24).fill("#0d1b2a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    doc.text("#", colX[0], tableY + 8, { width: colW[0], align: "center" });
    doc.text("SUBJECT", colX[1], tableY + 8, { width: colW[1] });
    doc.text("DATE", colX[2], tableY + 8, { width: colW[2], align: "center" });
    doc.text("TIME", colX[3], tableY + 8, { width: colW[3], align: "center" });
    doc.text("ROOM", colX[4], tableY + 8, { width: colW[4], align: "center" });

    tableY += 24;

    // Rows
    ds.forEach((r, i) => {
      const rh = 22;
      if (tableY + rh > doc.page.height - 120) {
        doc.addPage();
        tableY = 50;
      }
      if (i % 2 === 0) {
        doc.rect(40, tableY, doc.page.width - 80, rh).fill("#f8fafc");
      }
      doc.rect(40, tableY, doc.page.width - 80, rh).strokeColor("#cbd5e1").lineWidth(0.5).stroke();

      doc.fillColor("#1a2332").font("Helvetica").fontSize(9);
      const subjectLine = `${r.subject_name} (${r.subject_code})`;
      doc.text(String(i + 1), colX[0], tableY + 7, { width: colW[0], align: "center" });
      doc.text(subjectLine.length > 38 ? subjectLine.substring(0, 35) + "…" : subjectLine, colX[1], tableY + 7, { width: colW[1] });
      doc.text(new Date(r.exam_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), colX[2], tableY + 7, { width: colW[2], align: "center" });
      doc.text(`${r.start_time} - ${r.end_time}`, colX[3], tableY + 7, { width: colW[3], align: "center" });
      doc.text(r.room || "—", colX[4], tableY + 7, { width: colW[4], align: "center" });

      tableY += rh;
    });

    // INSTRUCTIONS
    tableY += 20;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("INSTRUCTIONS FOR CANDIDATES", 40, tableY, { width: doc.page.width - 80 });
    tableY += 16;
    doc.font("Helvetica").fontSize(9).fillColor("#1a2332");
    const instructions = [
      "1. Bring this admit card to the examination hall for every paper.",
      "2. Reach the examination center at least 30 minutes before the exam starts.",
      "3. Mobile phones, smart watches and electronic devices are strictly prohibited.",
      "4. Use blue/black ballpoint pen only. Do not use pencil or red pen.",
      "5. Any misconduct will lead to cancellation of the examination."
    ];
    instructions.forEach((line) => {
      doc.text(line, 50, tableY, { width: doc.page.width - 100 });
      tableY += 14;
    });

    // SIGNATURE
    const sigY = doc.page.height - 120;
    doc.moveTo(doc.page.width - 220, sigY).lineTo(doc.page.width - 60, sigY).stroke("#1a2332");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("Controller of Examination", doc.page.width - 220, sigY + 5, { width: 160, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", doc.page.width - 220, sigY + 20, { width: 160, align: "center" });

    doc.moveTo(40, sigY).lineTo(180, sigY).stroke("#1a2332");
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text("Candidate's Signature", 40, sigY + 5, { width: 140, align: "center" });

    // FOOTER
    doc.fontSize(7).fillColor("#94a3b8")
      .text(`Generated on ${new Date().toLocaleString("en-IN")} • This is a computer-generated admit card • Not valid without school seal`,
        40, doc.page.height - 40, { align: "center", width: doc.page.width - 80 });

    doc.end();
  } catch (err) {
    console.error("❌ Admit PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — list admit cards for an exam
// ============================================================
router.get("/examinations/:id/admitcards", requireAdmin, async (req, res) => {
  try {
    const rows = await q(
      `SELECT ac.*, s.name, s.class, s.roll_number as student_roll, s.student_photo_url
       FROM admit_cards ac JOIN Nstudent s ON s.student_id = ac.student_id
       WHERE ac.exam_id = ? ORDER BY ac.roll_number ASC, s.name ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Individual admit card toggle / update
router.put("/admitcards/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isEnabled, rollNumber } = req.body;
    const rows = await q("SELECT * FROM admit_cards WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

    await q(
      `UPDATE admit_cards SET is_enabled = ?, roll_number = ? WHERE id = ?`,
      [isEnabled !== undefined ? (isEnabled ? 1 : 0) : rows[0].is_enabled, rollNumber || rows[0].roll_number, id]
    );
    const updated = await q("SELECT * FROM admit_cards WHERE id = ?", [id]);
    res.json({ success: true, message: "Updated ✅", data: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/admitcards/:id", requireAdmin, async (req, res) => {
  try {
    await q("DELETE FROM admit_cards WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Admit card revoked ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
