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
      catch (e) { /* already exists */ }
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
// 🟢 PUBLIC — Professional Bonafide Certificate PDF (Single Page)
// ============================================================
router.get("/certificate/:studentId/pdf", async (req, res) => {
  try {
    const { studentId } = req.params;

    // Check enabled
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

    // Get student
    const rows = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = rows[0];

    // Build full address
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

    // Reference + date
    const refNo = cert.verification_code || `GSSS-${studentId.substring(0, 8)}`;
    const issueDate = cert.issued_date ? new Date(cert.issued_date) : new Date();
    const purpose = cert.purpose || "General Purpose";

    // Verification QR
    const verificationUrl = `${VERIFY_BASE}?code=${encodeURIComponent(refNo)}&id=${encodeURIComponent(s.student_id)}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verificationUrl)}`;
    const qrBuf = await fetchImageBuffer(qrApiUrl);

    // Logo + principal signature
    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");
    const photoBuf = await fetchImageBuffer(s.student_photo_url);

    // ==================== PDF ====================
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="bonafide-${studentId}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const M = 40;

    // ---- OUTER GOLD BORDER ----
    doc.rect(20, 20, PW - 40, PH - 40).lineWidth(3).strokeColor("#c9972b").stroke();
    doc.rect(28, 28, PW - 56, PH - 56).lineWidth(1).strokeColor("#c9972b").stroke();

    // ---- WATERMARK ----
    doc.save();
    doc.opacity(0.05);
    doc.fontSize(90).font("Helvetica-Bold").fillColor("#0d1b2a");
    doc.rotate(-45, { origin: [PW / 2, PH / 2] });
    doc.text("GSSS SHILLA", PW / 2 - 350, PH / 2 - 50, { width: 700, align: "center" });
    doc.restore();

    // ---- HEADER ----
    const headerY = 45;

    if (logoBuf) {
      try { doc.image(logoBuf, M + 10, headerY, { width: 70, height: 70 }); } catch (e) {}
    }

    doc.font("Helvetica-Bold").fontSize(22).fillColor("#0d1b2a")
      .text("GOVT. SR. SEC. SCHOOL SHILLA", M + 90, headerY + 8, { width: PW - M * 2 - 90, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#5a6a7e")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", M + 90, headerY + 36, { width: PW - M * 2 - 90, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
      .text("Affiliated to H.P. Board of School Education, Dharamshala", M + 90, headerY + 51, { width: PW - M * 2 - 90, align: "center" });

    // Divider
    doc.moveTo(M, 130).lineTo(PW - M, 130).lineWidth(2).strokeColor("#c9972b").stroke();
    doc.moveTo(M, 134).lineTo(PW - M, 134).lineWidth(0.5).strokeColor("#c9972b").stroke();

    // ---- TITLE BOX ----
    const titleBoxWidth = 280;
    const titleBoxX = (PW - titleBoxWidth) / 2;
    doc.rect(titleBoxX, 150, titleBoxWidth, 34).fillAndStroke("#0d1b2a", "#c9972b");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16)
      .text("BONAFIDE CERTIFICATE", titleBoxX, 160, { width: titleBoxWidth, align: "center", characterSpacing: 2 });

    // ---- REF NO + ISSUE DATE ----
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a");
    doc.text("Ref No: ", M + 10, 200, { continued: true });
    doc.font("Helvetica").fillColor("#c9972b").text(refNo);

    doc.font("Helvetica-Bold").fillColor("#0d1b2a")
      .text("Issue Date: ", M + 10, 218, { continued: true });
    doc.font("Helvetica").fillColor("#c9972b").text(fmtDateLong(issueDate));

    // ---- PHOTO (right side) ----
    const photoX = PW - M - 110;
    const photoY = 195;
    const photoW = 90;
    const photoH = 110;

    if (photoBuf) {
      try {
        doc.rect(photoX - 3, photoY - 3, photoW + 6, photoH + 6).fillAndStroke("#ffffff", "#c9972b");
        doc.image(photoBuf, photoX, photoY, { width: photoW, height: photoH });
      } catch (e) {}
    } else {
      doc.rect(photoX, photoY, photoW, photoH).fillAndStroke("#f8fafc", "#c9972b");
      doc.fontSize(9).fillColor("#94a3b8").text("No Photo", photoX + 20, photoY + 50, { width: photoW - 40, align: "center" });
    }
    doc.fontSize(8).fillColor("#475569").font("Helvetica-Bold")
      .text("STUDENT PHOTO", photoX, photoY + photoH + 6, { width: photoW, align: "center" });

    // ---- PERSONAL INFO TABLE ----
    let tblY = 250;
    const labelW = 105;
    const valueW = 175;
    const rowH = 22;
    const rowGap = 5;

    const rowsData = [
      ["Student ID", s.student_id, "Roll Number", s.roll_number || "—"],
      ["Full Name", s.name, "Admission Number", s.admission_number || "—"],
      ["Father's Name", s.father_name || "—", "Mother's Name", s.mother_name || "—"],
      ["Date of Birth", fmtDate(s.dob), "Gender", s.gender || "—"],
      ["Category", s.category || "—", "Aadhar Number", s.aadhar_number || "—"],
      ["APAAR ID", s.apaar_id || "—", "Mobile", s.mobile_number || "—"],
      ["Class", s.class, "Stream", streamDisplay],
      ["Session", s.session || "—", "Admission Date", fmtDate(s.admission_date)]
    ];

    const leftX = M + 10;
    const rightX = M + 10 + labelW + valueW + 15;

    for (let i = 0; i < rowsData.length; i++) {
      const [l1, v1, l2, v2] = rowsData[i];
      const y = tblY + i * (rowH + rowGap);

      // Left column
      doc.rect(leftX, y, labelW, rowH).fillAndStroke("#fef8ed", "#c9972b");
      doc.rect(leftX + labelW, y, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#0d1b2a")
        .text(l1.toUpperCase(), leftX + 6, y + 7, { width: labelW - 12 });
      doc.font("Helvetica").fontSize(9.5).fillColor("#1a2332")
        .text(String(v1 || "—"), leftX + labelW + 6, y + 6, { width: valueW - 12 });

      // Right column
      doc.rect(rightX, y, labelW, rowH).fillAndStroke("#fef8ed", "#c9972b");
      doc.rect(rightX + labelW, y, valueW, rowH).fillAndStroke("#ffffff", "#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#0d1b2a")
        .text(l2.toUpperCase(), rightX + 6, y + 7, { width: labelW - 12 });
      doc.font("Helvetica").fontSize(9.5).fillColor("#1a2332")
        .text(String(v2 || "—"), rightX + labelW + 6, y + 6, { width: valueW - 12 });
    }

    // ---- ADDRESS BOX ----
    const addrY = tblY + rowsData.length * (rowH + rowGap) + 8;
    doc.rect(leftX, addrY, PW - M * 2 - 20, 42).fillAndStroke("#f8fafc", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0d1b2a")
      .text("RESIDENTIAL ADDRESS", leftX + 8, addrY + 6);
    doc.font("Helvetica").fontSize(10).fillColor("#1a2332")
      .text(fullAddress, leftX + 8, addrY + 19, { width: PW - M * 2 - 40, height: 20, ellipsis: true });

    // ---- CERTIFICATION TEXT ----
    const textY = addrY + 55;
    doc.rect(M + 10, textY, PW - M * 2 - 20, 145).fillAndStroke("#fffbeb", "#c9972b");

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a")
      .text("TO WHOMSOEVER IT MAY CONCERN", M + 10, textY + 12, { width: PW - M * 2 - 20, align: "center", characterSpacing: 1 });

    doc.moveTo(M + 80, textY + 32).lineTo(PW - M - 80, textY + 32).lineWidth(0.5).strokeColor("#c9972b").stroke();

    const certText = `This is to certify that ${s.name}, son/daughter of Shri ${s.father_name || "—"} and Smt. ${s.mother_name || "—"}, is a bonafide student of Govt. Sr. Sec. School Shilla. He/She is currently studying in Class ${s.class}${isHigher ? " (" + streamDisplay + ")" : ""} with Roll Number ${s.roll_number || "—"} during the academic session ${s.session || "—"}. His/Her date of birth as per school records is ${fmtDate(s.dob)}.`;

    doc.font("Helvetica").fontSize(11).fillColor("#1a2332")
      .text(certText, M + 30, textY + 45, { width: PW - M * 2 - 60, align: "justify", lineGap: 4 });

    // Purpose line
    const purposeY = textY + 105;
    doc.rect(M + 30, purposeY, PW - M * 2 - 60, 30).fillAndStroke("#ffffff", "#c9972b");
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("PURPOSE: ", M + 40, purposeY + 10, { continued: true });
    doc.font("Helvetica").fillColor("#c9972b").text(purpose.toUpperCase());

    // ---- PRINCIPAL SIGNATURE ----
    const sigY = PH - 165;
    const sigX = PW - M - 200;

    if (principalBuf) {
      try { doc.image(principalBuf, sigX + 40, sigY - 30, { width: 120, height: 60 }); } catch (e) {}
    }

    doc.moveTo(sigX, sigY + 38).lineTo(sigX + 180, sigY + 38).lineWidth(1.5).strokeColor("#0d1b2a").stroke();
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text("Principal", sigX, sigY + 45, { width: 180, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", sigX, sigY + 60, { width: 180, align: "center" });

    // ---- SCHOOL SEAL PLACEHOLDER (left) ----
    doc.circle(M + 80, sigY + 20, 45).lineWidth(2).strokeColor("#c9972b").stroke();
    doc.circle(M + 80, sigY + 20, 38).lineWidth(0.5).strokeColor("#c9972b").stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#c9972b")
      .text("SCHOOL SEAL", M + 40, sigY + 16, { width: 80, align: "center" });

    // ---- QR CODE (bottom left) ----
    if (qrBuf) {
      try {
        doc.image(qrBuf, M + 200, sigY - 5, { width: 70, height: 70 });
        doc.font("Helvetica-Bold").fontSize(7).fillColor("#0d1b2a")
          .text("SCAN TO VERIFY", M + 195, sigY + 70, { width: 80, align: "center" });
      } catch (e) {}
    }

    // ---- FOOTER ----
    const footerY = PH - 75;
    doc.moveTo(M + 10, footerY).lineTo(PW - M - 10, footerY).lineWidth(0.5).strokeColor("#c9972b").stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text("Verification Code: ", M + 15, footerY + 8, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#c9972b").text(refNo);

    doc.font("Helvetica").fillColor("#64748b")
      .text("Issued on: ", M + 15, footerY + 22, { continued: true });
    doc.font("Helvetica-Bold").fillColor("#0d1b2a").text(fmtDateLong(issueDate));

    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#94a3b8")
      .text("This is a computer-generated certificate issued by GSSS Shilla.", M + 15, footerY + 38, { width: PW - M * 2 - 30, align: "center" });

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
