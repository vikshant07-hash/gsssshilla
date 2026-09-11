const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

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
        purpose VARCHAR(200) DEFAULT 'General Purpose',
        verification_code VARCHAR(40) DEFAULT NULL,
        issued_date DATE DEFAULT NULL,
        enabled_at TIMESTAMP NULL,
        enabled_by VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_student (student_id),
        INDEX idx_enabled (is_enabled)
      )
    `);

    const safeAdd = async (col, def) => {
      try { await q(`ALTER TABLE bonafide_certificates ADD COLUMN ${col} ${def}`); }
      catch (e) { /* exists */ }
    };
    await safeAdd("purpose", "VARCHAR(200) DEFAULT 'General Purpose'");
    await safeAdd("verification_code", "VARCHAR(40) DEFAULT NULL");
    await safeAdd("issued_date", "DATE DEFAULT NULL");

    console.log("✅ bonafide_certificates table ready");
  } catch (err) {
    console.error("❌ bonafide table create error:", err.message);
  }
})();

// ============================================================
// AUTH
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
// HELPERS
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

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtDateLong = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
};

const generateCode = (studentId) => {
  const raw = `${studentId}-${Date.now()}-${Math.random()}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `GSSS-${hash.substring(0, 8).toUpperCase()}`;
};

const VERIFY_BASE = "https://gsssshilla07.pages.dev/verify-bonafide.html";

// ============================================================
// 🟢 PUBLIC — my-status
// ============================================================
router.get("/my-status/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q(
      "SELECT is_enabled, enabled_at, purpose, verification_code, issued_date FROM bonafide_certificates WHERE student_id = ?",
      [studentId]
    );
    const enabled = rows.length > 0 && rows[0].is_enabled;
    res.json({
      success: true,
      enabled,
      enabledAt: rows[0]?.enabled_at || null,
      purpose: rows[0]?.purpose || null,
      verificationCode: rows[0]?.verification_code || null,
      issuedDate: rows[0]?.issued_date || null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// 🟢 PUBLIC — Bonafide PDF (Single Page, Profile Style)
// ============================================================
router.get("/certificate/:studentId/pdf", async (req, res) => {
  try {
    const { studentId } = req.params;

    const certRows = await q(
      "SELECT * FROM bonafide_certificates WHERE student_id = ?",
      [studentId]
    );
    if (!certRows.length || !certRows[0].is_enabled) {
      return res.status(403).json({
        success: false,
        message: "Bonafide certificate not enabled for this student. Contact school office."
      });
    }
    const cert = certRows[0];

    const rows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = rows[0];

    const fullAddress = [
      s.village,
      s.post_office ? "PO " + s.post_office : "",
      s.tehsil ? "Teh. " + s.tehsil : "",
      s.district ? "Distt. " + s.district : "",
      s.state,
      s.pincode
    ].filter(Boolean).join(", ") || s.address || "—";

    const isHigher = ["11","12"].includes(String(s.class));
    const streamDisplay = isHigher ? (s.stream || "—") : "Non-Specialized";

    const refNo = cert.verification_code || `GSSS-${studentId.substring(0, 8)}`;
    const issueDate = cert.issued_date ? new Date(cert.issued_date) : new Date();
    const purpose = cert.purpose || "General Purpose";

    // QR code URL
    const verificationUrl = `${VERIFY_BASE}?code=${encodeURIComponent(refNo)}&id=${encodeURIComponent(s.student_id)}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verificationUrl)}`;

    // Fetch images
    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");
    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const qrBuf = await fetchImageBuffer(qrApiUrl);

    // ==================== PDF ====================
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="bonafide-${studentId}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const M = 40;

    // ==================== OUTER GOLD BORDER ====================
    doc.rect(18, 18, PW - 36, PH - 36).lineWidth(3).strokeColor("#c9972b").stroke();
    doc.rect(26, 26, PW - 52, PH - 52).lineWidth(1).strokeColor("#c9972b").stroke();

    // ==================== WATERMARK ====================
    doc.save();
    doc.opacity(0.05);
    doc.fontSize(90).font("Helvetica-Bold").fillColor("#0d1b2a");
    doc.rotate(-45, { origin: [PW / 2, PH / 2] });
    doc.text("GSSS SHILLA", PW / 2 - 350, PH / 2 - 50, { width: 700, align: "center" });
    doc.restore();

    // ==================== HEADER ====================
    let y = 50;

    if (logoBuf) {
      try { doc.image(logoBuf, M + 5, y, { width: 65, height: 65 }); } catch (e) {}
    }

    // School name
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#0d1b2a")
      .text("GOVT. SR. SEC. SCHOOL SHILLA", M + 80, y + 5, { width: PW - M * 2 - 80, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#5a6a7e")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", M + 80, y + 34, { width: PW - M * 2 - 80, align: "center" });

    y += 78;

    // Gold divider
    doc.moveTo(M, y).lineTo(PW - M, y).lineWidth(3).strokeColor("#c9972b").stroke();
    y += 8;

    // ==================== TITLE BOX ====================
    const titleBoxWidth = 320;
    const titleBoxX = (PW - titleBoxWidth) / 2;
    doc.rect(titleBoxX, y, titleBoxWidth, 32).fillAndStroke("#0d1b2a", "#c9972b");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15)
      .text("BONAFIDE CERTIFICATE", titleBoxX, y + 9, { width: titleBoxWidth, align: "center", characterSpacing: 2 });

    y += 45;

    // ==================== REF NO + ISSUE DATE ====================
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0d1b2a");
    doc.text("Ref No: ", M + 5, y, { continued: true });
    doc.font("Helvetica").fillColor("#c9972b").text(refNo);

    doc.font("Helvetica-Bold").fillColor("#0d1b2a")
      .text("Issue Date: ", PW - M - 180, y, { continued: true, width: 175 });
    doc.font("Helvetica").fillColor("#c9972b").text(fmtDateLong(issueDate));

    y += 22;

    // ==================== PERSONAL INFORMATION TABLE ====================
    // Section heading
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#c9972b")
      .text("▸ PERSONAL INFORMATION", M + 5, y);
    y += 18;

    const rowH = 20;
    const gap = 4;
    const halfWidth = (PW - M * 2 - 100) / 2;
    const labelW = 95;
    const valueW = halfWidth - labelW;
    const leftColX = M + 5;
    const rightColX = M + 5 + halfWidth + 10;

    // Photo box (right side of table)
    const photoBoxW = 85;
    const photoBoxH = 105;
    const photoBoxX = PW - M - photoBoxW - 5;
    const photoBoxY = y;

    // Draw photo
    doc.rect(photoBoxX, photoBoxY, photoBoxW, photoBoxH).fillAndStroke("#f8fafc", "#c9972b");
    if (photoBuf) {
      try { doc.image(photoBuf, photoBoxX + 2, photoBoxY + 2, { width: photoBoxW - 4, height: photoBoxH - 4 }); } catch (e) {}
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
        .text("No Photo", photoBoxX, photoBoxY + 45, { width: photoBoxW, align: "center" });
    }

    // Personal info rows (left + right column side by side)
    const personalRows = [
      ["Student ID", s.student_id, "Admission No", s.admission_number || "—"],
      ["Full Name", s.name, "Gender", s.gender || "—"],
      ["Father's Name", s.father_name || "—", "Mother's Name", s.mother_name || "—"],
      ["Date of Birth", fmtDate(s.dob), "Category", s.category || "—"],
      ["Aadhar Number", s.aadhar_number || "—", "APAAR ID", s.apaar_id || "—"],
      ["Mobile", s.mobile_number || "—", "Email", s.email_id || "—"]
    ];

    for (let i = 0; i < personalRows.length; i++) {
      const [l1, v1, l2, v2] = personalRows[i];
      const rowY = y + i * (rowH + gap);

      // LEFT ROW
      doc.rect(leftColX, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#e2e8f0");
      doc.rect(leftColX + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0d1b2a")
        .text(l1.toUpperCase(), leftColX + 5, rowY + 6, { width: labelW - 10 });
      doc.font("Helvetica").fontSize(9).fillColor("#1a2332")
        .text(String(v1 || "—"), leftColX + labelW + 5, rowY + 5, { width: valueW - 10, ellipsis: true });

      // RIGHT ROW
      doc.rect(rightColX, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#e2e8f0");
      doc.rect(rightColX + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0d1b2a")
        .text(l2.toUpperCase(), rightColX + 5, rowY + 6, { width: labelW - 10 });
      doc.font("Helvetica").fontSize(9).fillColor("#1a2332")
        .text(String(v2 || "—"), rightColX + labelW + 5, rowY + 5, { width: valueW - 10, ellipsis: true });
    }

    y += personalRows.length * (rowH + gap) + 10;

    // ==================== ACADEMIC INFORMATION ====================
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#c9972b")
      .text("▸ ACADEMIC INFORMATION", M + 5, y);
    y += 18;

    const academicRows = [
      ["Class", s.class || "—", "Stream", streamDisplay],
      ["Roll Number", s.roll_number || "—", "Session", s.session || "—"],
      ["Status", (s.status || "Active").toUpperCase(), "Admission Date", fmtDate(s.admission_date)],
      ["Promoted From", s.promoted_from || "—", "Promotion Date", fmtDate(s.promotion_date)]
    ];

    for (let i = 0; i < academicRows.length; i++) {
      const [l1, v1, l2, v2] = academicRows[i];
      const rowY = y + i * (rowH + gap);

      doc.rect(leftColX, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#e2e8f0");
      doc.rect(leftColX + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0d1b2a")
        .text(l1.toUpperCase(), leftColX + 5, rowY + 6, { width: labelW - 10 });
      doc.font("Helvetica").fontSize(9).fillColor("#1a2332")
        .text(String(v1 || "—"), leftColX + labelW + 5, rowY + 5, { width: valueW - 10, ellipsis: true });

      doc.rect(rightColX, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#e2e8f0");
      doc.rect(rightColX + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0d1b2a")
        .text(l2.toUpperCase(), rightColX + 5, rowY + 6, { width: labelW - 10 });
      doc.font("Helvetica").fontSize(9).fillColor("#1a2332")
        .text(String(v2 || "—"), rightColX + labelW + 5, rowY + 5, { width: valueW - 10, ellipsis: true });
    }

    y += academicRows.length * (rowH + gap) + 10;

    // ==================== RESIDENTIAL ADDRESS ====================
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#c9972b")
      .text("▸ RESIDENTIAL ADDRESS", M + 5, y);
    y += 18;

    doc.rect(M + 5, y, PW - M * 2 - 10, 40).fillAndStroke("#f8fafc", "#c9972b");
    doc.font("Helvetica").fontSize(10).fillColor("#1a2332")
      .text(fullAddress, M + 15, y + 13, { width: PW - M * 2 - 30 });

    y += 55;

    // ==================== PURPOSE LINE ====================
    doc.rect(M + 5, y, PW - M * 2 - 10, 34).fillAndStroke("#fef8ed", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("PURPOSE OF CERTIFICATE:", M + 18, y + 11, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#c9972b").text(" " + purpose.toUpperCase());

    y += 48;

    // ==================== CERTIFICATION TEXT ====================
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#c9972b")
      .text("▸ CERTIFICATION", M + 5, y);
    y += 18;

    const certText = `This is to certify that ${s.name}, son/daughter of Shri ${s.father_name || "—"} and Smt. ${s.mother_name || "—"}, is a bonafide student of Govt. Sr. Sec. School Shilla. He/She is currently studying in Class ${s.class}${isHigher ? " (" + streamDisplay + ")" : ""} with Roll Number ${s.roll_number || "—"} during the academic session ${s.session || "—"}. His/Her date of birth as per school records is ${fmtDate(s.dob)}.`;

    const textHeight = doc.heightOfString(certText, { width: PW - M * 2 - 40 });
    doc.rect(M + 5, y, PW - M * 2 - 10, textHeight + 20).fillAndStroke("#fffbeb", "#c9972b");
    doc.font("Helvetica").fontSize(10.5).fillColor("#1a2332")
      .text(certText, M + 18, y + 10, { width: PW - M * 2 - 36, align: "justify", lineGap: 3 });

    y += textHeight + 30;

    // ==================== SIGNATURE AREA ====================
    const sigY = PH - 170;

    // Date box (left)
    doc.rect(M + 10, sigY, 165, 50).fillAndStroke("#fef8ed", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text(fmtDateLong(issueDate), M + 10, sigY + 10, { width: 165, align: "center" });
    doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
      .text("DATE OF ISSUE", M + 10, sigY + 28, { width: 165, align: "center", characterSpacing: 1 });

    // Principal signature (right)
    const sigX = PW - M - 200;
    if (principalBuf) {
      try { doc.image(principalBuf, sigX + 40, sigY - 30, { width: 120, height: 60 }); } catch (e) {}
    }
    doc.moveTo(sigX, sigY + 35).lineTo(sigX + 180, sigY + 35).lineWidth(1.5).strokeColor("#0d1b2a").stroke();
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text("Principal", sigX, sigY + 42, { width: 180, align: "center" });
    doc.font("Helvetica").fontSize(8.5).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", sigX, sigY + 57, { width: 180, align: "center" });

    // QR (center)
    if (qrBuf) {
      try {
        doc.image(qrBuf, PW / 2 - 35, sigY - 15, { width: 70, height: 70 });
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#0d1b2a")
          .text("SCAN TO VERIFY", PW / 2 - 50, sigY + 60, { width: 100, align: "center" });
      } catch (e) {}
    }

    // ==================== FOOTER ====================
    const footerY = PH - 85;

    // Security text line
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#cbd5e1")
      .text("GSSS SHILLA OFFICIAL DOCUMENT | GSSS SHILLA OFFICIAL DOCUMENT | GSSS SHILLA OFFICIAL DOCUMENT", M + 5, footerY - 12, { width: PW - M * 2 - 10, align: "center", characterSpacing: 2 });

    doc.moveTo(M + 5, footerY).lineTo(PW - M - 5, footerY).lineWidth(2).strokeColor("#c9972b").stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#475569")
      .text("Verification Code: ", M + 15, footerY + 8, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#c9972b").text(refNo);

    doc.font("Helvetica").fillColor("#475569")
      .text("Issued on: ", M + 15, footerY + 22, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#0d1b2a").text(fmtDateLong(issueDate));

    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#94a3b8")
      .text("This is a computer-generated certificate issued by GSSS Shilla.", PW - M - 220, footerY + 8, { width: 215, align: "right" });

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0d1b2a")
      .text("Page 1 of 1", PW - M - 220, footerY + 22, { width: 215, align: "right" });

    doc.end();
  } catch (err) {
    console.error("❌ Bonafide PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// 🔒 ADMIN — status-bulk
// ============================================================
router.post("/status-bulk", requireAdmin, async (req, res) => {
  try {
    const { studentIds } = req.body || {};
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
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// 🔒 ADMIN — enable single
// ============================================================
router.post("/enable", requireAdmin, async (req, res) => {
  try {
    const { studentId, purpose } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: "studentId required" });

    const students = await q("SELECT id, name FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!students.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const code = generateCode(studentId);
    const purposeVal = (purpose && purpose.trim()) || "General Purpose";

    await q(
      `INSERT INTO bonafide_certificates 
        (student_id, is_enabled, purpose, verification_code, issued_date, enabled_at)
       VALUES (?, 1, ?, ?, CURDATE(), NOW())
       ON DUPLICATE KEY UPDATE 
        is_enabled = 1,
        purpose = VALUES(purpose),
        verification_code = IFNULL(verification_code, VALUES(verification_code)),
        issued_date = IFNULL(issued_date, CURDATE()),
        enabled_at = NOW()`,
      [studentId, purposeVal, code]
    );

    res.json({ success: true, message: `Bonafide enabled for ${students[0].name} ✅` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// 🔒 ADMIN — disable single
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

    res.json({ success: true, message: `Bonafide disabled ✅` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// 🔒 ADMIN — enable class
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
      const code = generateCode(s.student_id);
      await q(
        `INSERT INTO bonafide_certificates 
          (student_id, is_enabled, purpose, verification_code, issued_date, enabled_at)
         VALUES (?, 1, 'General Purpose', ?, CURDATE(), NOW())
         ON DUPLICATE KEY UPDATE 
          is_enabled = 1,
          verification_code = IFNULL(verification_code, VALUES(verification_code)),
          issued_date = IFNULL(issued_date, CURDATE()),
          enabled_at = NOW()`,
        [s.student_id, code]
      );
      count++;
    }

    res.json({ success: true, message: `Bonafide enabled for ${count} students in Class ${cls} ✅`, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// 🔒 ADMIN — disable class
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
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
