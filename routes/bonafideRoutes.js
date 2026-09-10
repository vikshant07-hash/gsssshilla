const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// ENSURE TABLE
// ============================================================
(async () => {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS bonafide_certificates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id VARCHAR(40) NOT NULL UNIQUE,
        is_enabled TINYINT(1) DEFAULT 0,
        enabled_at TIMESTAMP NULL,
        enabled_by VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_student (student_id),
        INDEX idx_enabled (is_enabled)
      )
    `);
    console.log("✅ bonafide_certificates table ready");
  } catch (err) {
    console.error("❌ bonafide table create error:", err.message);
  }
})();

// ============================================================
// AUTH HELPER
// ============================================================
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  // Simple pass-through; real JWT verify happens in your admin middleware
  req.adminToken = auth.substring(7);
  next();
};

// ============================================================
// STATUS BULK — which students have bonafide enabled
// ============================================================
router.post("/status-bulk", requireAdmin, async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || !studentIds.length) {
      return res.json({ success: true, map: {} });
    }
    const ph = studentIds.map(() => "?").join(",");
    const rows = await q(
      `SELECT student_id, is_enabled FROM bonafide_certificates WHERE student_id IN (${ph})`,
      studentIds
    );
    const map = {};
    studentIds.forEach(id => { map[id] = false; });
    rows.forEach(r => { map[r.student_id] = !!r.is_enabled; });
    res.json({ success: true, map });
  } catch (err) {
    console.error("❌ status-bulk error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ENABLE single student
// ============================================================
router.post("/enable", requireAdmin, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: "studentId required" });

    // Verify student exists
    const students = await q("SELECT id FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!students.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    await q(
      `INSERT INTO bonafide_certificates (student_id, is_enabled, enabled_at)
       VALUES (?, 1, NOW())
       ON DUPLICATE KEY UPDATE is_enabled = 1, enabled_at = NOW()`,
      [studentId]
    );

    res.json({ success: true, message: `Bonafide enabled for ${studentId} ✅` });
  } catch (err) {
    console.error("❌ enable error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// DISABLE single student
// ============================================================
router.post("/disable", requireAdmin, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: "studentId required" });

    await q(
      `INSERT INTO bonafide_certificates (student_id, is_enabled)
       VALUES (?, 0)
       ON DUPLICATE KEY UPDATE is_enabled = 0`,
      [studentId]
    );

    res.json({ success: true, message: `Bonafide disabled for ${studentId}` });
  } catch (err) {
    console.error("❌ disable error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ENABLE for whole class
// ============================================================
router.post("/enable-class", requireAdmin, async (req, res) => {
  try {
    const { class: cls } = req.body;
    if (!cls) return res.status(400).json({ success: false, message: "class required" });

    const students = await q("SELECT student_id FROM Nstudent WHERE class = ?", [cls]);
    if (!students.length) {
      return res.json({ success: true, message: "No students in this class", count: 0 });
    }

    let count = 0;
    for (const s of students) {
      await q(
        `INSERT INTO bonafide_certificates (student_id, is_enabled, enabled_at)
         VALUES (?, 1, NOW())
         ON DUPLICATE KEY UPDATE is_enabled = 1, enabled_at = NOW()`,
        [s.student_id]
      );
      count++;
    }

    res.json({ success: true, message: `Bonafide enabled for ${count} students in Class ${cls} ✅`, count });
  } catch (err) {
    console.error("❌ enable-class error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// DISABLE for whole class
// ============================================================
router.post("/disable-class", requireAdmin, async (req, res) => {
  try {
    const { class: cls } = req.body;
    if (!cls) return res.status(400).json({ success: false, message: "class required" });

    const students = await q("SELECT student_id FROM Nstudent WHERE class = ?", [cls]);
    if (!students.length) {
      return res.json({ success: true, message: "No students in this class", count: 0 });
    }

    let count = 0;
    for (const s of students) {
      await q(
        `INSERT INTO bonafide_certificates (student_id, is_enabled)
         VALUES (?, 0)
         ON DUPLICATE KEY UPDATE is_enabled = 0`,
        [s.student_id]
      );
      count++;
    }

    res.json({ success: true, message: `Bonafide disabled for ${count} students in Class ${cls}`, count });
  } catch (err) {
    console.error("❌ disable-class error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — check if own bonafide is enabled
// ============================================================
router.get("/my-status/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q(
      "SELECT is_enabled, enabled_at FROM bonafide_certificates WHERE student_id = ?",
      [studentId]
    );
    const enabled = rows.length > 0 && rows[0].is_enabled;
    res.json({ success: true, enabled, enabledAt: rows[0]?.enabled_at || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GENERATE PDF — bonafide certificate
// ============================================================
const fetchImageBuffer = (url) => new Promise((resolve) => {
  if (!url) return resolve(null);
  const client = url.startsWith("https") ? https : http;
  client.get(url, (resp) => {
    if (resp.statusCode !== 200) return resolve(null);
    const chunks = [];
    resp.on("data", c => chunks.push(c));
    resp.on("end", () => resolve(Buffer.concat(chunks)));
  }).on("error", () => resolve(null));
});

router.get("/certificate/:studentId/pdf", async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check enabled
    const certRows = await q(
      "SELECT is_enabled FROM bonafide_certificates WHERE student_id = ?",
      [studentId]
    );
    if (!certRows.length || !certRows[0].is_enabled) {
      return res.status(403).json({ success: false, message: "Bonafide certificate not enabled for this student" });
    }

    // Get student
    const rows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = rows[0];

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="bonafide-${studentId}.pdf"`);
    doc.pipe(res);

    // HEADER
    doc.rect(0, 0, doc.page.width, 90).fill("#0d1b2a");
    doc.rect(0, 90, doc.page.width, 4).fill("#c9972b");

    // Logo (skip if fails)
    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    if (logoBuf) {
      try { doc.image(logoBuf, 40, 15, { width: 60, height: 60 }); } catch (e) {}
    }

    doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold")
      .text("Govt. Sr. Sec. School Shilla", 110, 22, { align: "center", width: doc.page.width - 220 });
    doc.fontSize(10).font("Helvetica")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", 110, 50, { align: "center", width: doc.page.width - 220 });
    doc.fontSize(9).fillColor("#c9972b").font("Helvetica-Bold")
      .text("BONAFIDE CERTIFICATE", 110, 68, { align: "center", width: doc.page.width - 220, characterSpacing: 2 });

    doc.fillColor("#000000");
    doc.y = 120;

    // PHOTO
    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const px = doc.page.width - 140;
    const py = 120;

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
    doc.fillColor("#0d1b2a").fontSize(12).font("Helvetica-Bold");
    const labelY = (offset) => 130 + offset;
    const left = 40;
    const midX = 260;

    const row = (label, value, x, y) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#c9972b").text(`${label}:`, x, y);
      doc.font("Helvetica").fontSize(11).fillColor("#1a2332").text(String(value ?? "—"), x + 90, y);
    };

    row("Student ID", s.student_id, left, labelY(0));
    row("Admission No", s.admission_number, left, labelY(22));
    row("Full Name", s.name, left, labelY(44));
    row("Father's Name", s.father_name, left, labelY(66));
    row("Mother's Name", s.mother_name, left, labelY(88));
    row("Date of Birth", s.dob, left, labelY(110));
    row("Category", s.category, left, labelY(132));
    row("Aadhar Number", s.aadhar_number, left, labelY(154));

    row("Class", s.class, midX, labelY(0));
    row("Roll Number", s.roll_number, midX, labelY(22));
    row("Session", s.session, midX, labelY(44));
    row("APAAR ID", s.apaar_id, midX, labelY(66));
    row("Gender", s.gender, midX, labelY(88));
    row("Mobile", s.mobile_number, midX, labelY(110));
    row("Email", s.email_id, midX, labelY(132));

    // Address
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#c9972b").text("Address:", left, labelY(185));
    doc.font("Helvetica").fontSize(11).fillColor("#1a2332").text(s.address || "—", left + 90, labelY(185), { width: 400 });

    // CERTIFICATION TEXT
    const certY = labelY(230);
    doc.rect(40, certY, doc.page.width - 80, 100).fillAndStroke("#fef8ed", "#c9972b");

    doc.fillColor("#0d1b2a").fontSize(11).font("Helvetica-Bold")
      .text("TO WHOMSOEVER IT MAY CONCERN", 40, certY + 12, { align: "center", width: doc.page.width - 80 });

    doc.font("Helvetica").fontSize(11).fillColor("#1a2332")
      .text(
        `This is to certify that ${s.name}, S/o Shri. ${s.father_name} & Smt. ${s.mother_name}, ` +
        `bearing Student ID ${s.student_id}, is a bonafide student of Govt. Sr. Sec. School Shilla, ` +
        `studying in Class ${s.class} (Roll No: ${s.roll_number || "—"}) during the academic session ${s.session}. ` +
        `His/Her date of birth as per school records is ${s.dob}.`,
        60, certY + 35,
        { width: doc.page.width - 120, align: "justify", lineGap: 4 }
      );

    // SIGNATURE
    const sigY = certY + 130;
    doc.font("Helvetica").fontSize(11).fillColor("#1a2332")
      .text("Date: " + new Date().toLocaleDateString("en-IN"), 40, sigY + 60);
    doc.text("Place: Shilla", 40, sigY + 80);

    doc.moveTo(doc.page.width - 220, sigY + 80).lineTo(doc.page.width - 60, sigY + 80).stroke("#1a2332");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text("Principal", doc.page.width - 220, sigY + 85, { width: 160, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", doc.page.width - 220, sigY + 100, { width: 160, align: "center" });

    // FOOTER
    doc.fontSize(8).fillColor("#94a3b8")
      .text(`Generated on ${new Date().toLocaleString("en-IN")} • This is a computer-generated certificate`, 40, doc.page.height - 40, { align: "center", width: doc.page.width - 80 });

    doc.end();
  } catch (err) {
    console.error("❌ Bonafide PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
