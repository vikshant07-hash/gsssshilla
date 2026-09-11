const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// AUTH — admin token check
// ============================================================
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized - admin token required" });
  }
  req.adminToken = auth.substring(7);
  next();
};

// ============================================================
// ENSURE TABLES ON LOAD
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
// HELPERS
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

const formatDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const formatTime = (t) => {
  if (!t) return "—";
  const parts = String(t).split(":");
  const h = parseInt(parts[0]);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

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
      return res.status(400).json({ success: false, message: "Name, code and class required" });
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
      `UPDATE subjects SET subject_name=?, subject_code=?, class=?, stream=?, max_marks=?, is_active=? WHERE id=?`,
      [subjectName, subjectCode.toUpperCase(), cls, streamVal, maxMarks || 100, isActive !== undefined ? (isActive ? 1 : 0) : 1, id]
    );
    const rows = await q("SELECT * FROM subjects WHERE id = ?", [id]);
    res.json({ success: true, message: "Subject updated ✅", data: rows[0] });
  } catch (err) {
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
        (SELECT COUNT(*) FROM date_sheet WHERE exam_id = e.id) as subjects_count,
        (SELECT COUNT(*) FROM admit_cards WHERE exam_id = e.id AND is_enabled = 1) as admit_count
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
      `UPDATE examinations SET exam_name=?, exam_type=?, class=?, stream=?, 
       exam_session=?, academic_session=?, start_date=?, end_date=?, is_active=? WHERE id=?`,
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
    res.json({ success: true, message: "Exam deleted ✅" });
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
      return res.status(400).json({ success: false, message: "Subject, date and times required" });
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
// DATE SHEET PDF — per class
// ============================================================
router.get("/examinations/:id/datesheet/pdf", async (req, res) => {
  try {
    const { id } = req.params;
    const examRows = await q("SELECT * FROM examinations WHERE id = ?", [id]);
    if (!examRows.length) return res.status(404).json({ success: false, message: "Exam not found" });
    const exam = examRows[0];

    const ds = await q(
      `SELECT ds.*, s.subject_name, s.subject_code, s.max_marks
       FROM date_sheet ds JOIN subjects s ON s.id = ds.subject_id
       WHERE ds.exam_id = ? ORDER BY ds.exam_date ASC, ds.start_time ASC`,
      [id]
    );

    if (!ds.length) return res.status(400).json({ success: false, message: "No date sheet entries to print" });

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="datesheet-class${exam.class}-${id}.pdf"`);
    doc.pipe(res);

    // HEADER BAND
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
      .text("DATE SHEET", 120, 75, { align: "center", width: doc.page.width - 240, characterSpacing: 4 });

    doc.fillColor("#000000");

    // EXAM INFO BAR
    doc.rect(40, 130, doc.page.width - 80, 60).fillAndStroke("#fef8ed", "#c9972b");
    doc.fillColor("#0d1b2a").font("Helvetica-Bold").fontSize(13)
      .text(exam.exam_name, 50, 138, { width: doc.page.width - 100, align: "center" });
    doc.fontSize(9).fillColor("#5a6a7e").font("Helvetica")
      .text(`Exam Type: ${exam.exam_type}  |  Class: ${exam.class}${["11","12"].includes(String(exam.class)) ? " · " + exam.stream : ""}`, 50, 160, { width: doc.page.width - 100, align: "center" });
    doc.text(`Exam Session: ${exam.exam_session}  |  Academic Session: ${exam.academic_session}`, 50, 174, { width: doc.page.width - 100, align: "center" });

    // TABLE HEADER
    let tableY = 215;
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a")
      .text("EXAMINATION SCHEDULE", 40, 200);
    doc.rect(40, tableY - 5, doc.page.width - 80, 2).fill("#c9972b");

    const colX = [45, 95, 300, 390, 490];
    const colW = [45, 200, 85, 95, 95];

    doc.rect(40, tableY, doc.page.width - 80, 26).fill("#0d1b2a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    doc.text("#", colX[0], tableY + 9, { width: colW[0], align: "center" });
    doc.text("SUBJECT", colX[1], tableY + 9, { width: colW[1] });
    doc.text("CODE", colX[2], tableY + 9, { width: colW[2], align: "center" });
    doc.text("DATE", colX[3], tableY + 9, { width: colW[3], align: "center" });
    doc.text("TIME", colX[4], tableY + 9, { width: colW[4], align: "center" });

    tableY += 26;

    ds.forEach((r, i) => {
      const rh = 24;
      if (tableY + rh > doc.page.height - 150) {
        doc.addPage();
        tableY = 50;
      }
      if (i % 2 === 0) doc.rect(40, tableY, doc.page.width - 80, rh).fill("#f8fafc");
      doc.rect(40, tableY, doc.page.width - 80, rh).strokeColor("#cbd5e1").lineWidth(0.5).stroke();

      doc.fillColor("#1a2332").font("Helvetica").fontSize(9.5);
      const subjectLine = r.subject_name.length > 32 ? r.subject_name.substring(0, 29) + "…" : r.subject_name;
      doc.text(String(i + 1), colX[0], tableY + 8, { width: colW[0], align: "center" });
      doc.font("Helvetica-Bold").text(subjectLine, colX[1], tableY + 8, { width: colW[1] });
      doc.font("Helvetica").fillColor("#c9972b").text(r.subject_code, colX[2], tableY + 8, { width: colW[2], align: "center" });
      doc.fillColor("#1a2332").text(formatDate(r.exam_date), colX[3], tableY + 8, { width: colW[3], align: "center" });
      doc.text(`${formatTime(r.start_time)} - ${formatTime(r.end_time)}`, colX[4], tableY + 8, { width: colW[4], align: "center" });

      tableY += rh;
    });

    // TOTAL SUBJECTS
    tableY += 15;
    doc.rect(40, tableY, doc.page.width - 80, 30).fillAndStroke("#fef8ed", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text(`Total Subjects: ${ds.length}`, 50, tableY + 8, { width: doc.page.width - 100, align: "center" });

    // INSTRUCTIONS
    tableY += 50;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text("IMPORTANT INSTRUCTIONS", 40, tableY);
    doc.rect(40, tableY + 15, doc.page.width - 80, 1).fill("#c9972b");
    tableY += 25;

    const instructions = [
      "1. Students must be present in the examination hall 30 minutes before the exam starts.",
      "2. Bring admit card and school ID card for every paper.",
      "3. Mobile phones, smart watches, and electronic devices are strictly prohibited.",
      "4. Use blue/black ballpoint pen only. Do not use pencil or red pen.",
      "5. Any misconduct will lead to cancellation of the examination.",
      "6. Students should read all questions carefully before attempting.",
      "7. No student will be allowed to leave the hall before the exam ends."
    ];
    doc.font("Helvetica").fontSize(9.5).fillColor("#1a2332");
    instructions.forEach((line) => {
      doc.text(line, 50, tableY, { width: doc.page.width - 100 });
      tableY += 15;
    });

    // SIGNATURE
    const sigY = doc.page.height - 100;
    doc.moveTo(doc.page.width - 220, sigY).lineTo(doc.page.width - 60, sigY).stroke("#1a2332");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("Controller of Examination", doc.page.width - 220, sigY + 5, { width: 160, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", doc.page.width - 220, sigY + 20, { width: 160, align: "center" });

    // FOOTER
    doc.fontSize(7).fillColor("#94a3b8")
      .text(`Generated on ${new Date().toLocaleString("en-IN")} • Official date sheet`,
        40, doc.page.height - 40, { align: "center", width: doc.page.width - 80 });

    doc.end();
  } catch (err) {
    console.error("❌ DateSheet PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// FETCH CLASS STUDENTS — full info from Nstudent
// ============================================================
router.get("/examinations/:id/students", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const examRows = await q("SELECT * FROM examinations WHERE id = ?", [id]);
    if (!examRows.length) return res.status(404).json({ success: false, message: "Exam not found" });
    const exam = examRows[0];

    const students = await q(
      `SELECT id, student_id, name, father_name, mother_name, roll_number, class, 
              stream, student_photo_url, gender, category, dob, 
              aadhar_number, apaar_id, mobile_number, email_id, session,
              village, post_office, tehsil, district, state, pincode, address
       FROM Nstudent
       WHERE class = ? AND session = ? AND status = 'Active'
       ORDER BY CAST(roll_number AS UNSIGNED) ASC, name ASC`,
      [exam.class, exam.academic_session]
    );

    const admitRows = await q(
      "SELECT student_id, is_enabled, roll_number FROM admit_cards WHERE exam_id = ?",
      [id]
    );
    const admitMap = {};
    admitRows.forEach(r => { admitMap[r.student_id] = r; });

    const result = students.map(s => ({
      ...s,
      admit_enabled: admitMap[s.student_id] ? !!admitMap[s.student_id].is_enabled : false,
      admit_roll: admitMap[s.student_id]?.roll_number || null
    }));

    res.json({
      success: true,
      exam: {
        id: exam.id,
        exam_name: exam.exam_name,
        exam_type: exam.exam_type,
        class: exam.class,
        stream: exam.stream,
        academic_session: exam.academic_session,
        exam_session: exam.exam_session
      },
      students: result,
      total: result.length,
      published_count: admitRows.filter(r => r.is_enabled).length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PUBLISH — bulk (all) or selected studentIds
// ============================================================
router.post("/examinations/:id/publish", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { studentIds } = req.body || {};

    const examRows = await q("SELECT * FROM examinations WHERE id = ?", [id]);
    if (!examRows.length) return res.status(404).json({ success: false, message: "Exam not found" });
    const exam = examRows[0];

    const ds = await q("SELECT COUNT(*) as c FROM date_sheet WHERE exam_id = ?", [id]);
    if (!ds[0].c) return res.status(400).json({ success: false, message: "Add date sheet first before publishing" });

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
         WHERE class = ? AND session = ? AND status = 'Active'`,
        [exam.class, exam.academic_session]
      );
    }

    if (!students.length) {
      return res.status(400).json({ success: false, message: "No students found" });
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

    const isPublishingAll = !Array.isArray(studentIds) || studentIds.length === 0;
    if (isPublishingAll) {
      await q("UPDATE examinations SET is_published = 1, published_at = NOW() WHERE id = ?", [id]);
    }

    res.json({
      success: true,
      message: `Admit cards published for ${count} student(s) ✅`,
      count,
      published_all: isPublishingAll
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/examinations/:id/unpublish", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { studentIds } = req.body || {};

    if (Array.isArray(studentIds) && studentIds.length) {
      const ph = studentIds.map(() => "?").join(",");
      await q(
        `UPDATE admit_cards SET is_enabled = 0 WHERE exam_id = ? AND student_id IN (${ph})`,
        [id, ...studentIds]
      );
      return res.json({ success: true, message: "Unpublished for selected students ✅" });
    }

    await q("UPDATE admit_cards SET is_enabled = 0 WHERE exam_id = ?", [id]);
    await q("UPDATE examinations SET is_published = 0 WHERE id = ?", [id]);
    res.json({ success: true, message: "Exam unpublished ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — list own admit cards (public)
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
// ADMIT CARD PDF — public
// ============================================================
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

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="admit-${studentId}-${examId}.pdf"`);
    doc.pipe(res);

    // HEADER
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

    // EXAM INFO BAR
    doc.rect(40, 130, doc.page.width - 80, 50).fillAndStroke("#fef8ed", "#c9972b");
    doc.fillColor("#0d1b2a").font("Helvetica-Bold").fontSize(13)
      .text(exam.exam_name, 50, 138, { width: doc.page.width - 100, align: "center" });
    doc.fontSize(9).fillColor("#5a6a7e").font("Helvetica")
      .text(`Exam Type: ${exam.exam_type}  |  Exam Session: ${exam.exam_session}  |  Class: ${exam.class}${["11","12"].includes(String(exam.class)) ? " · " + exam.stream : ""}`, 50, 158, { width: doc.page.width - 100, align: "center" });

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
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#c9972b").text(`${label}:`, x, y);
      doc.font("Helvetica").fontSize(10).fillColor("#1a2332").text(String(value ?? "—"), x + 85, y);
    };

    row("Student Name", s.name, 40, 205);
    row("Student ID", s.student_id, 40, 222);
    row("Father's Name", s.father_name, 40, 239);
    row("Mother's Name", s.mother_name, 40, 256);
    row("Date of Birth", formatDate(s.dob), 40, 273);
    row("Gender", s.gender, 40, 290);
    row("Category", s.category, 40, 307);

    row("Roll Number", admit.roll_number || s.roll_number || "—", 300, 205);
    row("Aadhar Number", s.aadhar_number, 300, 222);
    row("APAAR ID", s.apaar_id, 300, 239);
    row("Mobile", s.mobile_number, 300, 256);
    row("Email", s.email_id, 300, 273);
    row("Class & Stream", `${s.class}${["11","12"].includes(String(s.class)) ? " · " + (s.stream || "—") : ""}`, 300, 290);
    row("Academic Session", exam.academic_session, 300, 307);

    // ADDRESS
    const fullAddress = [s.village, s.post_office && "PO " + s.post_office, s.tehsil && "Teh. " + s.tehsil,
                         s.district && "Distt. " + s.district, s.state, s.pincode].filter(Boolean).join(", ") || s.address || "—";
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#c9972b").text("Address:", 40, 327);
    doc.font("Helvetica").fontSize(9.5).fillColor("#1a2332").text(fullAddress, 125, 327, { width: 480 });

    // DATE SHEET TABLE
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a")
      .text("EXAMINATION SCHEDULE", 40, 355, { width: doc.page.width - 80 });
    doc.rect(40, 373, doc.page.width - 80, 2).fill("#c9972b");

    let tableY = 385;
    const colX = [45, 90, 300, 400, 500];
    const colW = [45, 210, 100, 100, 100];

    doc.rect(40, tableY, doc.page.width - 80, 24).fill("#0d1b2a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    doc.text("#", colX[0], tableY + 8, { width: colW[0], align: "center" });
    doc.text("SUBJECT", colX[1], tableY + 8, { width: colW[1] });
    doc.text("DATE", colX[2], tableY + 8, { width: colW[2], align: "center" });
    doc.text("TIME", colX[3], tableY + 8, { width: colW[3], align: "center" });
    doc.text("ROOM", colX[4], tableY + 8, { width: colW[4], align: "center" });

    tableY += 24;

    ds.forEach((r, i) => {
      const rh = 22;
      if (tableY + rh > doc.page.height - 130) {
        doc.addPage();
        tableY = 50;
      }
      if (i % 2 === 0) doc.rect(40, tableY, doc.page.width - 80, rh).fill("#f8fafc");
      doc.rect(40, tableY, doc.page.width - 80, rh).strokeColor("#cbd5e1").lineWidth(0.5).stroke();

      doc.fillColor("#1a2332").font("Helvetica").fontSize(9);
      const subjectLine = `${r.subject_name} (${r.subject_code})`;
      doc.text(String(i + 1), colX[0], tableY + 7, { width: colW[0], align: "center" });
      doc.text(subjectLine.length > 38 ? subjectLine.substring(0, 35) + "…" : subjectLine, colX[1], tableY + 7, { width: colW[1] });
      doc.text(formatDate(r.exam_date), colX[2], tableY + 7, { width: colW[2], align: "center" });
      doc.text(`${formatTime(r.start_time)}-${formatTime(r.end_time)}`, colX[3], tableY + 7, { width: colW[3], align: "center" });
      doc.text(r.room || "—", colX[4], tableY + 7, { width: colW[4], align: "center" });

      tableY += rh;
    });

    // INSTRUCTIONS
    tableY += 20;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("INSTRUCTIONS FOR CANDIDATES", 40, tableY, { width: doc.page.width - 80 });
    tableY += 16;
    const instructions = [
      "1. Bring this admit card to the examination hall for every paper.",
      "2. Reach the examination center at least 30 minutes before the exam starts.",
      "3. Mobile phones, smart watches and electronic devices are strictly prohibited.",
      "4. Use blue/black ballpoint pen only. Do not use pencil or red pen.",
      "5. Any misconduct will lead to cancellation of the examination."
    ];
    doc.font("Helvetica").fontSize(9).fillColor("#1a2332");
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
      .text(`Generated on ${new Date().toLocaleString("en-IN")} • Computer-generated admit card • Not valid without school seal`,
        40, doc.page.height - 40, { align: "center", width: doc.page.width - 80 });

    doc.end();
  } catch (err) {
    console.error("❌ Admit PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — list admit cards for exam
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
