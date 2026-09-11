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
    return res.status(401).json({ success: false, message: "Unauthorized - admin token required" });
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
// 🟢 PUBLIC — Bonafide PDF (Single Page, Professional Layout)
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
    const M = 30;
    const contentW = PW - M * 2;

    // ==================== OUTER GOLD BORDER ====================
    doc.rect(15, 15, PW - 30, PH - 30).lineWidth(3).strokeColor("#c9972b").stroke();
    doc.rect(22, 22, PW - 44, PH - 44).lineWidth(1).strokeColor("#c9972b").stroke();

    // ==================== WATERMARK ====================
    doc.save();
    doc.opacity(0.04);
    doc.fontSize(85).font("Helvetica-Bold").fillColor("#0d1b2a");
    doc.rotate(-45, { origin: [PW / 2, PH / 2] });
    doc.text("GSSS SHILLA", PW / 2 - 350, PH / 2 - 50, { width: 700, align: "center" });
    doc.restore();

    let y = 40;

    // ==================== HEADER ====================
    if (logoBuf) {
      try { doc.image(logoBuf, M, y, { width: 55, height: 55 }); } catch (e) {}
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0d1b2a")
      .text("GOVT. SR. SEC. SCHOOL SHILLA", M + 65, y + 3, { width: contentW - 65, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", M + 65, y + 28, { width: contentW - 65, align: "center" });

    y += 68;
    doc.moveTo(M, y).lineTo(PW - M, y).lineWidth(2.5).strokeColor("#c9972b").stroke();
    y += 10;

    // ==================== TITLE BOX ====================
    const titleBoxWidth = 280;
    const titleBoxX = (PW - titleBoxWidth) / 2;
    doc.rect(titleBoxX, y, titleBoxWidth, 28).fillAndStroke("#0d1b2a", "#c9972b");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(13)
      .text("BONAFIDE CERTIFICATE", titleBoxX, y + 8, { width: titleBoxWidth, align: "center", characterSpacing: 1.5 });

    y += 40;

    // ==================== REF + DATE ====================
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0d1b2a");
    doc.text("Ref No: ", M, y, { continued: true });
    doc.font("Helvetica").fillColor("#c9972b").text(refNo);

    doc.font("Helvetica-Bold").fillColor("#0d1b2a")
      .text("Issue Date: ", M + contentW - 175, y, { continued: true, width: 170 });
    doc.font("Helvetica").fillColor("#c9972b").text(fmtDateLong(issueDate));

    y += 20;

    // ==================== PERSONAL INFORMATION ====================
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#c9972b")
      .text("PERSONAL INFORMATION", M, y);
    y += 16;

    const rowH = 18;
    const gap = 3;
    const labelW = 90;
    const photoBoxW = 75;
    const photoBoxH = 95;
    const photoBoxX = PW - M - photoBoxW;
    const photoBoxY = y;

    // Photo
    doc.rect(photoBoxX, photoBoxY, photoBoxW, photoBoxH).fillAndStroke("#f8fafc", "#c9972b");
    if (photoBuf) {
      try { doc.image(photoBuf, photoBoxX + 2, photoBoxY + 2, { width: photoBoxW - 4, height: photoBoxH - 4 }); } catch (e) {}
    } else {
      doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
        .text("No Photo", photoBoxX, photoBoxY + 40, { width: photoBoxW, align: "center" });
    }

    // Table area (left of photo)
    const tableW = contentW - photoBoxW - 12;
    const colW = tableW / 2;
    const valueW = colW - labelW;

    const personalRows = [
      ["STUDENT ID", s.student_id, "ADMISSION NO", s.admission_number || "—"],
      ["FULL NAME", s.name, "GENDER", s.gender || "—"],
      ["FATHER'S NAME", s.father_name || "—", "MOTHER'S NAME", s.mother_name || "—"],
      ["DATE OF BIRTH", fmtDate(s.dob), "CATEGORY", s.category || "—"],
      ["AADHAR NUMBER", s.aadhar_number || "—", "APAAR ID", s.apaar_id || "—"],
      ["MOBILE", s.mobile_number || "—", "EMAIL", s.email_id || "—"]
    ];

    for (let i = 0; i < personalRows.length; i++) {
      const [l1, v1, l2, v2] = personalRows[i];
      const rowY = y + i * (rowH + gap);

      // Left cell
      doc.rect(M, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#c9972b");
      doc.rect(M + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0d1b2a")
        .text(l1, M + 4, rowY + 6, { width: labelW - 8 });
      doc.font("Helvetica").fontSize(8).fillColor("#1a2332")
        .text(String(v1 || "—"), M + labelW + 4, rowY + 5, { width: valueW - 8, ellipsis: true });

      // Right cell
      doc.rect(M + colW, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#c9972b");
      doc.rect(M + colW + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0d1b2a")
        .text(l2, M + colW + 4, rowY + 6, { width: labelW - 8 });
      doc.font("Helvetica").fontSize(8).fillColor("#1a2332")
        .text(String(v2 || "—"), M + colW + labelW + 4, rowY + 5, { width: valueW - 8, ellipsis: true });
    }

    y += personalRows.length * (rowH + gap) + 8;

    // ==================== ACADEMIC INFORMATION ====================
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#c9972b")
      .text("ACADEMIC INFORMATION", M, y);
    y += 16;

    const academicRows = [
      ["CLASS", s.class || "—", "STREAM", streamDisplay],
      ["ROLL NUMBER", s.roll_number || "—", "SESSION", s.session || "—"],
      ["STATUS", (s.status || "Active").toUpperCase(), "ADMISSION DATE", fmtDate(s.admission_date)]
    ];

    for (let i = 0; i < academicRows.length; i++) {
      const [l1, v1, l2, v2] = academicRows[i];
      const rowY = y + i * (rowH + gap);

      doc.rect(M, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#c9972b");
      doc.rect(M + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0d1b2a")
        .text(l1, M + 4, rowY + 6, { width: labelW - 8 });
      doc.font("Helvetica").fontSize(8).fillColor("#1a2332")
        .text(String(v1 || "—"), M + labelW + 4, rowY + 5, { width: valueW - 8, ellipsis: true });

      doc.rect(M + colW, rowY, labelW, rowH).fillAndStroke("#fef8ed", "#c9972b");
      doc.rect(M + colW + labelW, rowY, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0d1b2a")
        .text(l2, M + colW + 4, rowY + 6, { width: labelW - 8 });
      doc.font("Helvetica").fontSize(8).fillColor("#1a2332")
        .text(String(v2 || "—"), M + colW + labelW + 4, rowY + 5, { width: valueW - 8, ellipsis: true });
    }

    y += academicRows.length * (rowH + gap) + 8;

    // ==================== ADDRESS ====================
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#c9972b")
      .text("RESIDENTIAL ADDRESS", M, y);
    y += 16;

    const addrText = fullAddress;
    const addrHeight = Math.max(30, doc.heightOfString(addrText, { width: contentW - 20 }) + 14);
    doc.rect(M, y, contentW, addrHeight).fillAndStroke("#f8fafc", "#c9972b");
    doc.font("Helvetica").fontSize(9).fillColor("#1a2332")
      .text(addrText, M + 8, y + 8, { width: contentW - 16 });

    y += addrHeight + 8;

    // ==================== PURPOSE ====================
    doc.rect(M, y, contentW, 28).fillAndStroke("#fef8ed", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0d1b2a")
      .text("PURPOSE OF CERTIFICATE: ", M + 10, y + 9, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#c9972b").text(purpose.toUpperCase());

    y += 38;

    // ==================== CERTIFICATION TEXT ====================
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#c9972b")
      .text("CERTIFICATION", M, y);
    y += 16;

    const certText = `This is to certify that ${s.name}, son/daughter of Shri ${s.father_name || "—"} and Smt. ${s.mother_name || "—"}, is a bonafide student of Govt. Sr. Sec. School Shilla. He/She is currently studying in Class ${s.class}${isHigher ? " (" + streamDisplay + ")" : ""} with Roll Number ${s.roll_number || "—"} during the academic session ${s.session || "—"}. His/Her date of birth as per school records is ${fmtDate(s.dob)}.`;

    const certHeight = doc.heightOfString(certText, { width: contentW - 24 }) + 18;
    doc.rect(M, y, contentW, certHeight).fillAndStroke("#fffbeb", "#c9972b");
    doc.font("Helvetica").fontSize(9.5).fillColor("#1a2332")
      .text(certText, M + 12, y + 8, { width: contentW - 24, align: "justify", lineGap: 3 });

    y += certHeight + 15;

    // ==================== SIGNATURE AREA ====================
    const sigAreaY = Math.max(y, PH - 140);

    // Date box (left)
    doc.rect(M, sigAreaY, 150, 42).fillAndStroke("#fef8ed", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text(fmtDateLong(issueDate), M, sigAreaY + 8, { width: 150, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor("#475569")
      .text("DATE OF ISSUE", M, sigAreaY + 25, { width: 150, align: "center", characterSpacing: 0.8 });

    // QR (center)
    if (qrBuf) {
      try {
        doc.image(qrBuf, PW / 2 - 30, sigAreaY - 5, { width: 60, height: 60 });
        doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0d1b2a")
          .text("SCAN TO VERIFY", PW / 2 - 45, sigAreaY + 58, { width: 90, align: "center" });
      } catch (e) {}
    }

    // Principal signature (right)
    const sigX = PW - M - 165;
    if (principalBuf) {
      try { doc.image(principalBuf, sigX + 30, sigAreaY - 25, { width: 105, height: 50 }); } catch (e) {}
    }
    doc.moveTo(sigX, sigAreaY + 30).lineTo(sigX + 165, sigAreaY + 30).lineWidth(1.2).strokeColor("#0d1b2a").stroke();
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("Principal", sigX, sigAreaY + 35, { width: 165, align: "center" });
    doc.font("Helvetica").fontSize(7.5).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", sigX, sigAreaY + 49, { width: 165, align: "center" });

    // ==================== FOOTER ====================
    const footerY = PH - 62;

    doc.font("Helvetica-Bold").fontSize(6).fillColor("#cbd5e1")
      .text("GSSS SHILLA OFFICIAL DOCUMENT", 0, footerY - 10, { width: PW, align: "center", characterSpacing: 3 });

    doc.moveTo(M, footerY).lineTo(PW - M, footerY).lineWidth(1.5).strokeColor("#c9972b").stroke();

    doc.font("Helvetica").fontSize(7.5).fillColor("#475569")
      .text("Verification Code: ", M, footerY + 6, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#c9972b").text(refNo);

    doc.font("Helvetica").fillColor("#475569")
      .text("Issued on: ", M, footerY + 18, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#0d1b2a").text(fmtDateLong(issueDate));

    doc.font("Helvetica-Oblique").fontSize(6.5).fillColor("#94a3b8")
      .text("This is a computer-generated certificate", PW - M - 180, footerY + 6, { width: 180, align: "right" });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0d1b2a")
      .text("Page 1 of 1", PW - M - 180, footerY + 18, { width: 180, align: "right" });

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
