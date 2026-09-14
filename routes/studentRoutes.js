const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const path = require("path");

const db = require("../config/db");
const { cloudinary, uploadStudent } = require("../config/cloudinary");

// ==================== MULTER FIELDS ====================
const studentUploadFields = uploadStudent.fields([
  { name: "studentPhoto", maxCount: 1 },
  { name: "signature", maxCount: 1 },
  { name: "aadharCard", maxCount: 1 },
  { name: "himachaliBonafide", maxCount: 1 },
  { name: "casteCertificate", maxCount: 1 },
  { name: "apaarCard", maxCount: 1 },
  { name: "previousMarksheet", maxCount: 1 },
  { name: "incomeCertificate", maxCount: 1 },
  { name: "bplCertificate", maxCount: 1 },
  { name: "otherDocument", maxCount: 1 }
]);

// ==================== CONSTANTS ====================
const DOC_FIELDS = [
  "studentPhoto", "signature", "aadharCard", "himachaliBonafide",
  "casteCertificate", "apaarCard", "previousMarksheet",
  "incomeCertificate", "bplCertificate", "otherDocument"
];

const BASE_REQUIRED_DOCS = [
  "studentPhoto", "signature", "aadharCard", "himachaliBonafide",
  "apaarCard", "previousMarksheet"
];

const CASTE_REQUIRED_CATEGORIES = ["SC", "ST", "OBC", "Other", "EWS"];

const IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const PDF_MIME_TYPES = ["application/pdf"];
const PDF_MAX_BYTES = 2 * 1024 * 1024;

const IMAGE_ONLY_FIELDS = ["studentPhoto", "signature"];
const PDF_ONLY_FIELDS = [
  "aadharCard", "himachaliBonafide", "casteCertificate", "apaarCard",
  "previousMarksheet", "incomeCertificate", "bplCertificate", "otherDocument"
];

const EMAIL_MAX_STUDENTS = 1;
const MOBILE_MAX_STUDENTS = 3;

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function getRequiredDocs(category) {
  const docs = [...BASE_REQUIRED_DOCS];
  if (CASTE_REQUIRED_CATEGORIES.includes(category)) docs.push("casteCertificate");
  return docs;
}

const CLASS_ORDER = ["Nursery", "LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const PROMOTED_VISIBLE_MS = 60 * 60 * 1000;
const AUTO_REVERT_INTERVAL_MS = 5 * 60 * 1000;

// ==================== HELPERS ====================
const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

const BODY_FIELDS = [
  "studentId", "admissionNumber", "admissionDate", "name", "fatherName",
  "motherName", "dob", "aadharNumber", "apaarId", "class", "rollNumber",
  "session", "mobileNumber", "emailId", "gender", "category", "address",
  "status", "promotedFrom", "promotionDate", "stream", "village", "postOffice", "tehsil", "district", "state", "pincode",
  "emailVerified"
];

const pickBody = (b) => {
  const out = {};
  for (const k of BODY_FIELDS) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== "") out[toSnake(k)] = b[k];
  }
  return out;
};

const extractFiles = (files) => {
  const out = {};
  if (!files) return out;
  for (const f of DOC_FIELDS) {
    if (files[f] && files[f][0]) {
      const snake = toSnake(f);
      out[`${snake}_url`] = files[f][0].path;
      out[`${snake}_pid`] = files[f][0].filename;
    }
  }
  return out;
};

const incrementSession = (s) => {
  const m = /^(\d{4})-(\d{2,4})$/.exec(s);
  if (!m) return s;
  const startYear = parseInt(m[1]) + 1;
  const endYear = startYear + 1;
  const endPart = m[2].length === 2 ? endYear.toString().substring(2) : String(endYear);
  return `${startYear}-${endPart}`;
};

const nextClass = (currentClass) => {
  const idx = CLASS_ORDER.indexOf(String(currentClass));
  if (idx === -1 || idx === CLASS_ORDER.length - 1) return null;
  return CLASS_ORDER[idx + 1];
};

const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// ✅ AADHAAR VALIDATION
// ============================================================
function normalizeAadhaar(v) {
  return String(v || "").replace(/[\s-]/g, "");
}
function hasValidAadhaarStart(a) {
  return /^[2-9]\d{11}$/.test(a);
}

const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];

function validateVerhoeff(num) {
  let c = 0;
  const reversed = String(num).split("").reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) c = d[c][p[i % 8][reversed[i]]];
  return c === 0;
}

// ============================================================
// ✅ AUTO-REVERT PROMOTED
// ============================================================
async function autoRevertExpiredPromotions() {
  try {
    const result = await q(
      `UPDATE Nstudent SET status = 'Active', promotion_date = NULL
       WHERE status = 'Promoted' AND promotion_date IS NOT NULL
       AND promotion_date <= (NOW() - INTERVAL 1 HOUR)`
    );
    return result.affectedRows || 0;
  } catch (err) { return 0; }
}

function revertStatusIfExpired(student) {
  if (!student) return student;
  if (student.status === "Promoted" && student.promotion_date &&
      new Date(student.promotion_date).getTime() + PROMOTED_VISIBLE_MS <= Date.now()) {
    student.status = "Active";
    student.promotion_date = null;
  }
  return student;
}

let _autoRevertTimer = null;
function startAutoRevertTimer() {
  if (_autoRevertTimer) return;
  autoRevertExpiredPromotions();
  _autoRevertTimer = setInterval(autoRevertExpiredPromotions, AUTO_REVERT_INTERVAL_MS);
  if (_autoRevertTimer.unref) _autoRevertTimer.unref();
  console.log(`⏰ Auto-revert timer started`);
}
startAutoRevertTimer();

// ============================================================
// ✅ OTP TABLES
// ============================================================
(async () => {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS student_otps (
        id INT PRIMARY KEY AUTO_INCREMENT,
        type VARCHAR(20) NOT NULL,
        target VARCHAR(255) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        purpose VARCHAR(50) DEFAULT 'verify',
        expires_at DATETIME NOT NULL,
        attempts INT DEFAULT 0,
        verified BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_target_type (target, type),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await q(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        \`value\` VARCHAR(500) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ student_otps & settings tables ready");
  } catch (err) {
    console.error("❌ table create error:", err.message);
  }
})();

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function saveOTP(type, target, otp, purpose = "verify") {
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  await q(`DELETE FROM student_otps WHERE type = ? AND target = ? AND purpose = ?`, [type, target, purpose]);
  await q(`INSERT INTO student_otps (type, target, otp, purpose, expires_at) VALUES (?, ?, ?, ?, ?)`, [type, target, otp, purpose, expiresAt]);
}

async function verifyOTP(type, target, otp, purpose = "verify") {
  const rows = await q(
    `SELECT * FROM student_otps 
     WHERE type = ? AND target = ? AND purpose = ? AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [type, target, purpose]
  );
  if (!rows.length) return { valid: false, reason: "NO_OTP_OR_EXPIRED" };
  const rec = rows[0];
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    await q(`DELETE FROM student_otps WHERE id = ?`, [rec.id]);
    return { valid: false, reason: "TOO_MANY_ATTEMPTS", attempts: rec.attempts };
  }
  if (String(rec.otp) !== String(otp).trim()) {
    await q(`UPDATE student_otps SET attempts = attempts + 1 WHERE id = ?`, [rec.id]);
    return { valid: false, reason: "INVALID_OTP", attempts: rec.attempts + 1 };
  }
  await q(`UPDATE student_otps SET verified = 1 WHERE id = ?`, [rec.id]);
  return { valid: true };
}

// ============================================================
// ✅ EMAIL SENDER (Brevo)
// ============================================================
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@gssshilla.in";
const BREVO_SENDER_NAME = "GSSS SHILLA";
const SCHOOL_LOGO_URL = "https://gsssshilla07.pages.dev/logo(1).png";
const SCHOOL_WEBSITE = "https://gsssshilla07.pages.dev";

// OTP email (existing)
async function sendEmailOTP(toEmail, otp, purpose = "verify") {
  if (!BREVO_API_KEY) throw new Error("BREVO_API_KEY not configured");
  const headingText = purpose === "add" ? "Student Registration Verification"
    : purpose === "update" ? "Student Update Verification"
      : "Email Verification";

  const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>OTP Verification</title></head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family: Arial, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.08);">
<tr><td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%); padding: 32px 24px; text-align:center;">
<img src="${SCHOOL_LOGO_URL}" alt="GSSS" width="80" height="80" style="border-radius:50%; background:#fff; padding:6px; margin-bottom:12px;">
<h1 style="color:#fff; font-size:22px; margin:8px 0 2px;">GSSS SHILLA</h1>
<p style="color:#e0e7ff; font-size:13px; margin:0;">Govt. Sr. Sec. School Shilla</p>
</td></tr>
<tr><td style="padding: 32px 28px;">
<h2 style="color:#1e293b; font-size:18px; margin:0 0 8px;">${headingText}</h2>
<p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 20px;">
Use the OTP below to verify your email address for student registration.
</p>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%); border: 1.5px dashed #6366f1; border-radius: 12px; padding: 20px;">
<p style="margin:0 0 8px; color:#6366f1; font-size:12px; font-weight:600; text-transform:uppercase;">Your OTP Code</p>
<div style="font-size:36px; font-weight:800; letter-spacing:10px; color:#1e1b4b;">${otp}</div>
</td></tr>
</table>
<p style="color:#94a3b8; font-size:12px; margin:20px 0 0; line-height:1.6;">
⏱ Valid for <strong>5 minutes</strong>.<br>
If you didn't request this, ignore this email.
</p>
</td></tr>
<tr><td style="background:#f8fafc; padding: 16px 24px; text-align:center; border-top:1px solid #e2e8f0;">
<p style="margin:0; color:#94a3b8; font-size:11px;">© ${new Date().getFullYear()} GSSS SHILLA</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "api-key": BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: `OTP for Student Verification — GSSS SHILLA`,
      htmlContent,
      textContent: `Your OTP: ${otp}\nValid for 5 minutes.`
    })
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Email send failed (${response.status}): ${errBody}`);
  }
  return response.json();
}

// ============================================================
// ✅ REGISTRATION SUCCESS EMAIL (Beautiful Welcome)
// ============================================================
async function sendRegistrationSuccessEmail(student, pdfBuffer) {
  if (!BREVO_API_KEY) {
    console.warn("BREVO_API_KEY not set, skipping welcome email");
    return null;
  }

  const s = student;
  const loginUrl = `${SCHOOL_WEBSITE}/student-login.html`;
  const pdfBase64 = pdfBuffer.toString("base64");

  const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Welcome to GSSS Shilla</title></head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family: Arial, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:20px; overflow:hidden; box-shadow:0 8px 40px rgba(0,0,0,0.1);">
  <tr><td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%); padding: 40px 32px; text-align:center;">
    <img src="${SCHOOL_LOGO_URL}" alt="GSSS" width="100" height="100" style="border-radius:50%; background:#fff; padding:8px; margin-bottom:16px; box-shadow:0 4px 20px rgba(0,0,0,0.15);">
    <h1 style="color:#fff; font-size:26px; margin:0 0 4px; letter-spacing:0.5px;">GSSS SHILLA</h1>
    <p style="color:#e0e7ff; font-size:13px; margin:0; letter-spacing:1px;">Govt. Sr. Sec. School Shilla</p>
    <p style="color:#c7d2fe; font-size:11px; margin:6px 0 0; letter-spacing:0.5px;">Affiliated to HPBOSE · Recognized by Govt. of HP</p>
  </td></tr>

  <tr><td style="padding: 40px 36px;">
    <h2 style="color:#1e293b; font-size:22px; margin:0 0 12px;">🎉 Welcome, ${s.name}!</h2>
    <p style="color:#475569; font-size:15px; line-height:1.7; margin:0 0 24px;">
      Congratulations! Your registration at <b>Govt. Sr. Sec. School Shilla</b> has been completed successfully. We're delighted to welcome you to our school family.
    </p>

    <!-- Student Details Card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%); border: 1.5px solid #c7d2fe; border-radius: 14px; margin-bottom: 24px;">
      <tr><td style="padding: 20px 24px;">
        <p style="margin:0 0 14px; color:#4f46e5; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px;">📋 Your Student Details</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          <tr><td style="padding: 7px 0; color:#64748b; width:40%;">Student ID:</td><td style="padding: 7px 0; color:#1e293b; font-weight:700;">${s.student_id}</td></tr>
          <tr><td style="padding: 7px 0; color:#64748b;">Admission No:</td><td style="padding: 7px 0; color:#1e293b; font-weight:700;">${s.admission_number || "-"}</td></tr>
          <tr><td style="padding: 7px 0; color:#64748b;">Class:</td><td style="padding: 7px 0; color:#1e293b; font-weight:700;">${s.class}${s.stream && ["11","12"].includes(String(s.class)) ? " · " + s.stream : ""}</td></tr>
          <tr><td style="padding: 7px 0; color:#64748b;">Roll Number:</td><td style="padding: 7px 0; color:#1e293b; font-weight:700;">${s.roll_number || "-"}</td></tr>
          <tr><td style="padding: 7px 0; color:#64748b;">Session:</td><td style="padding: 7px 0; color:#1e293b; font-weight:700;">${s.session || "-"}</td></tr>
        </table>
      </td></tr>
    </table>

    <!-- Login Credentials -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1.5px solid #f59e0b; border-radius: 14px; margin-bottom: 24px;">
      <tr><td style="padding: 20px 24px;">
        <p style="margin:0 0 14px; color:#92400e; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px;">🔐 Your Login Credentials</p>
        <p style="margin:0 0 12px; color:#78350f; font-size:13px; line-height:1.6;">
          Use these credentials to log in to your student portal:
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          <tr><td style="padding: 7px 0; color:#78350f; width:40%;">APAAR ID:</td><td style="padding: 7px 0; color:#1e293b; font-weight:800; font-family: monospace; letter-spacing: 2px;">${s.apaar_id}</td></tr>
          <tr><td style="padding: 7px 0; color:#78350f;">Date of Birth:</td><td style="padding: 7px 0; color:#1e293b; font-weight:800;">${s.dob ? new Date(s.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "-"}</td></tr>
          <tr><td style="padding: 7px 0; color:#78350f;">Student ID:</td><td style="padding: 7px 0; color:#1e293b; font-weight:800;">${s.student_id}</td></tr>
          <tr><td style="padding: 7px 0; color:#78350f;">Class:</td><td style="padding: 7px 0; color:#1e293b; font-weight:800;">${s.class}</td></tr>
        </table>
        <p style="margin:14px 0 0; color:#92400e; font-size:12px; line-height:1.5;">
          <strong>⚠️ Important:</strong> Please keep these credentials safe and do not share them with anyone.
        </p>
      </td></tr>
    </table>

    <!-- Login Button -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr><td align="center">
        <a href="${loginUrl}" style="display:inline-block; padding: 16px 48px; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color:#fff; text-decoration:none; border-radius:50px; font-weight:800; font-size:15px; letter-spacing:1px; box-shadow: 0 8px 24px rgba(79,70,229,0.4);">
          🚀 Login to Student Portal
        </a>
      </td></tr>
    </table>

    <!-- Attachment Note -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:14px; margin-bottom: 24px;">
      <tr><td style="padding: 16px 20px;">
        <p style="margin:0; color:#166534; font-size:13px; line-height:1.6;">
          📎 <b>Attachment:</b> Your <b>Provisional Registration Form</b> is attached with this email. Please download and save it for your records.
        </p>
      </td></tr>
    </table>

    <!-- Help -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0; padding-top:20px;">
      <tr><td>
        <p style="margin:0 0 8px; color:#64748b; font-size:12px; line-height:1.6;">
          <b style="color:#1e293b;">Need help?</b> Contact the school office:
        </p>
        <p style="margin:0; color:#64748b; font-size:12px; line-height:1.7;">
          📞 +91 9805444375<br>
          📧 info@gssshilla.in<br>
          🌐 ${SCHOOL_WEBSITE}
        </p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#f8fafc; padding: 24px; text-align:center; border-top:1px solid #e2e8f0;">
    <p style="margin:0 0 6px; color:#94a3b8; font-size:11px; letter-spacing:0.5px;">
      This is an automated email from GSSS Shilla Student Management System
    </p>
    <p style="margin:0; color:#94a3b8; font-size:11px;">
      © ${new Date().getFullYear()} Govt. Sr. Sec. School Shilla · All rights reserved
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const payload = {
    sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
    to: [{ email: s.email_id }],
    subject: `🎓 Welcome to GSSS Shilla, ${s.name}! Your Registration is Complete`,
    htmlContent,
    textContent: `Welcome ${s.name}! Your registration at GSSS Shilla is complete.\n\nStudent ID: ${s.student_id}\nAPAAR ID: ${s.apaar_id}\nDOB: ${s.dob}\nClass: ${s.class}\n\nLogin: ${loginUrl}`,
    attachment: [{
      name: `Registration-${s.student_id}.pdf`,
      content: pdfBase64
    }]
  };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "api-key": BREVO_API_KEY },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Welcome email failed (${response.status}): ${errBody}`);
  }
  return response.json();
}

// ============================================================
// ✅ WELCOME PDF GENERATOR (Provisional Application Form)
// ============================================================
function fetchImageBuffer(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    try { new URL(url); } catch { return resolve(null); }
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (resp) => {
      if ([301, 302, 307, 308].includes(resp.statusCode) && resp.headers.location) {
        resp.resume();
        return resolve(fetchImageBuffer(resp.headers.location));
      }
      if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
      const ct = resp.headers["content-type"] || "";
      if (!ct.startsWith("image/")) { resp.resume(); return resolve(null); }
      const chunks = [];
      resp.on("data", c => chunks.push(c));
      resp.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function generateWelcomePDF(student) {
  return new Promise(async (resolve, reject) => {
    try {
      const s = student;
      const [logoBuf, photoBuf, sigBuf] = await Promise.all([
        fetchImageBuffer(SCHOOL_LOGO_URL),
        fetchImageBuffer(s.student_photo_url),
        fetchImageBuffer(s.signature_url)
      ]);

      const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 45, right: 45 } });
      const chunks = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const ML = 45;
      const MR = 45;
      const contentW = pageW - ML - MR;

      // ============================================================
      // WATERMARK
      // ============================================================
      doc.save();
      doc.opacity(0.04);
      doc.fontSize(80).fillColor("#c9972b").font("Helvetica-Bold");
      doc.translate(pageW / 2, pageH / 2);
      doc.rotate(-30, { origin: [0, 0] });
      doc.text("GSSS SHILLA", -300, -40, { width: 600, align: "center" });
      doc.restore();

      if (logoBuf) {
        doc.save();
        doc.opacity(0.05);
        doc.image(logoBuf, (pageW - 350) / 2, (pageH - 350) / 2, { width: 350, height: 350 });
        doc.restore();
      }

      // ============================================================
      // HEADER
      // ============================================================
      let y = 40;
      if (logoBuf) {
        try {
          doc.save();
          doc.circle(ML + 30, y + 30, 32).fill("#ffffff");
          doc.circle(ML + 30, y + 30, 31).lineWidth(1.5).strokeColor("#c9972b").stroke();
          doc.restore();
          doc.image(logoBuf, ML + 3, y + 3, { fit: [54, 54], align: "center", valign: "center" });
        } catch (e) {}
      }

      doc.font("Helvetica-Bold").fontSize(19).fillColor("#0d1b2a")
         .text("GOVT. SR. SEC. SCHOOL SHILLA", ML + 70, y + 4, { width: contentW - 70, align: "center" });
      doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
         .text("Shilla, Teh. Nerwa, Distt. Shimla, Himachal Pradesh — 171210", ML + 70, y + 28, { width: contentW - 70, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
         .text("Affiliated to HPBOSE · Recognized by Govt. of Himachal Pradesh", ML + 70, y + 42, { width: contentW - 70, align: "center" });

      y += 70;
      doc.moveTo(ML, y).lineTo(pageW - MR, y).lineWidth(3).strokeColor("#c9972b").stroke();
      doc.moveTo(ML, y + 3).lineTo(pageW - MR, y + 3).lineWidth(0.5).strokeColor("#0d1b2a").stroke();

      // ============================================================
      // TITLE BADGE
      // ============================================================
      y += 20;
      const titleText = "PROVISIONAL REGISTRATION FORM";
      doc.font("Helvetica-Bold").fontSize(13);
      const titleW = doc.widthOfString(titleText) + 60;
      const titleX = (pageW - titleW) / 2;
      doc.roundedRect(titleX, y, titleW, 26, 13).fill("#0d1b2a");
      doc.roundedRect(titleX, y, titleW, 26, 13).lineWidth(1.5).strokeColor("#c9972b").stroke();
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
         .text(titleText, titleX, y + 7, { width: titleW, align: "center", characterSpacing: 2 });

      y += 40;

      // ============================================================
      // PERSONAL INFO TABLE
      // ============================================================
      const drawRow = (label, value, isLast) => {
        const rowH = 22;
        doc.rect(ML, y, 160, rowH).fillColor("#fef8ed").fill();
        doc.rect(ML, y, 160, rowH).lineWidth(0.5).strokeColor("#c9972b").stroke();
        doc.rect(ML + 160, y, contentW - 160, rowH).lineWidth(0.5).strokeColor("#94a3b8").stroke();

        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
           .text(label, ML + 8, y + 7, { width: 145 });
        doc.font("Helvetica").fontSize(10.5).fillColor("#1a2332")
           .text(String(value || "—"), ML + 168, y + 7, { width: contentW - 176, lineBreak: false });
        y += rowH;
      };

      // Photo box (right side)
      const photoBoxW = 90, photoBoxH = 105;
      const photoBoxX = pageW - MR - photoBoxW;
      const photoBoxY = y;
      if (photoBuf) {
        try {
          doc.rect(photoBoxX - 2, photoBoxY - 2, photoBoxW + 4, photoBoxH + 4).fillAndStroke("#ffffff", "#c9972b");
          doc.image(photoBuf, photoBoxX, photoBoxY, { fit: [photoBoxW, photoBoxH], align: "center", valign: "center" });
        } catch (e) {}
      } else {
        doc.rect(photoBoxX, photoBoxY, photoBoxW, photoBoxH).fillAndStroke("#f8fafc", "#c9972b");
        doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
           .text("STUDENT PHOTO", photoBoxX, photoBoxY + photoBoxH / 2 - 4, { width: photoBoxW, align: "center" });
      }

      const infoW = contentW - photoBoxW - 15;
      const drawRowNarrow = (label, value) => {
        const rowH = 22;
        doc.rect(ML, y, 140, rowH).fillColor("#fef8ed").fill();
        doc.rect(ML, y, 140, rowH).lineWidth(0.5).strokeColor("#c9972b").stroke();
        doc.rect(ML + 140, y, infoW - 140, rowH).lineWidth(0.5).strokeColor("#94a3b8").stroke();
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0d1b2a")
           .text(label, ML + 8, y + 7, { width: 125 });
        doc.font("Helvetica").fontSize(10).fillColor("#1a2332")
           .text(String(value || "—"), ML + 148, y + 7, { width: infoW - 156, lineBreak: false });
        y += rowH;
      };

      drawRowNarrow("Student ID", s.student_id);
      drawRowNarrow("Admission No", s.admission_number);
      drawRowNarrow("Full Name", s.name);
      drawRowNarrow("Father's Name", s.father_name);
      drawRowNarrow("Class", s.class + (s.stream && ["11","12"].includes(String(s.class)) ? " · " + s.stream : ""));

      const afterInfoY = y;
      y = photoBoxY + photoBoxH + 8;
      if (y < afterInfoY) y = afterInfoY;

      // ============================================================
      // MORE DETAILS
      // ============================================================
      y += 8;
      const sectionTitle = (text) => {
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a").text(text, ML, y);
        doc.moveTo(ML, y + 16).lineTo(ML + 30, y + 16).lineWidth(2).strokeColor("#c9972b").stroke();
        y += 22;
      };

      sectionTitle("Personal Details");
      const drawFullRow = (label, value) => {
        const rowH = 20;
        doc.rect(ML, y, 160, rowH).fillColor("#fef8ed").fill();
        doc.rect(ML, y, 160, rowH).lineWidth(0.4).strokeColor("#c9972b").stroke();
        doc.rect(ML + 160, y, contentW - 160, rowH).lineWidth(0.4).strokeColor("#94a3b8").stroke();
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0d1b2a").text(label, ML + 6, y + 6, { width: 148 });
        doc.font("Helvetica").fontSize(10).fillColor("#1a2332").text(String(value || "—"), ML + 168, y + 6, { width: contentW - 176, lineBreak: false });
        y += rowH;
      };

      drawFullRow("Mother's Name", s.mother_name);
      drawFullRow("Date of Birth", s.dob ? new Date(s.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—");
      drawFullRow("Gender", s.gender);
      drawFullRow("Category", s.category);
      drawFullRow("Aadhaar Number", s.aadhar_number ? s.aadhar_number.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3") : "—");
      drawFullRow("APAAR ID", s.apaar_id);

      y += 8;
      sectionTitle("Academic Details");
      drawFullRow("Class", s.class);
      if (s.stream) drawFullRow("Stream", s.stream);
      drawFullRow("Roll Number", s.roll_number);
      drawFullRow("Session", s.session);
      drawFullRow("Admission Date", s.admission_date ? new Date(s.admission_date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—");

      y += 8;
      sectionTitle("Contact & Address");
      drawFullRow("Mobile Number", s.mobile_number);
      drawFullRow("Email ID", s.email_id);
      drawFullRow("Village / Town", s.village);
      drawFullRow("Post Office", s.post_office);
      drawFullRow("Tehsil", s.tehsil);
      drawFullRow("District", s.district);
      drawFullRow("State", s.state);
      drawFullRow("Pincode", s.pincode);

      // ============================================================
      // LOGIN CREDENTIALS BOX
      // ============================================================
      y += 12;
      const credBoxH = 95;
      if (y + credBoxH < pageH - 150) {
        doc.roundedRect(ML, y, contentW, credBoxH, 8).fillColor("#fef3c7").fill();
        doc.roundedRect(ML, y, contentW, credBoxH, 8).lineWidth(1.5).strokeColor("#f59e0b").stroke();

        doc.font("Helvetica-Bold").fontSize(11).fillColor("#92400e")
           .text("🔐 LOGIN CREDENTIALS — KEEP SAFE", ML + 14, y + 12);
        doc.font("Helvetica").fontSize(9.5).fillColor("#78350f")
           .text("Use these details to login to your student portal:", ML + 14, y + 30);

        doc.font("Helvetica-Bold").fontSize(10).fillColor("#78350f")
           .text("APAAR ID:", ML + 14, y + 50);
        doc.font("Courier-Bold").fontSize(11).fillColor("#1e293b")
           .text(s.apaar_id || "—", ML + 90, y + 50);

        doc.font("Helvetica-Bold").fontSize(10).fillColor("#78350f")
           .text("Date of Birth:", ML + 14, y + 68);
        doc.font("Courier-Bold").fontSize(11).fillColor("#1e293b")
           .text(s.dob ? new Date(s.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—", ML + 90, y + 68);

        doc.font("Helvetica").fontSize(8).fillColor("#92400e")
           .text(`Portal: ${SCHOOL_WEBSITE}/student-login.html`, ML + 14, y + 82);
        y += credBoxH + 12;
      }

      // ============================================================
      // SIGNATURE
      // ============================================================
      if (y < pageH - 130) {
        const sigW = 180;
        const sigX = pageW - MR - sigW;
        if (sigBuf) {
          try {
            doc.image(sigBuf, sigX + 40, y - 10, { fit: [100, 45], align: "center" });
          } catch (e) {}
        }
        const lineY = y + 40;
        doc.moveTo(sigX + 20, lineY).lineTo(sigX + sigW - 20, lineY).lineWidth(0.7).strokeColor("#64748b").stroke();
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
           .text("Principal", sigX, lineY + 6, { width: sigW, align: "center" });
        doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
           .text("Govt. Sr. Sec. School Shilla", sigX, lineY + 20, { width: sigW, align: "center" });
      }

      // ============================================================
      // FOOTER
      // ============================================================
      doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
         .text(`Generated: ${new Date().toLocaleString("en-IN")} · GSSS Shilla Official Document`, ML, pageH - 40, {
           width: contentW, align: "center", characterSpacing: 0.5
         });
      doc.moveTo(ML, pageH - 46).lineTo(pageW - MR, pageH - 46).lineWidth(0.5).strokeColor("#cbd5e1").stroke();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ============================================================
// ✅ FILE VALIDATION
// ============================================================
function validateUploadedFiles(req, res, next) {
  try {
    if (!req.files) return next();
    const errors = [];
    for (const field of IMAGE_ONLY_FIELDS) {
      const fileArr = req.files[field];
      if (!fileArr || !fileArr[0]) continue;
      const file = fileArr[0];
      if (!IMAGE_MIME_TYPES.includes(file.mimetype || "")) {
        errors.push({ field, message: `${field} must be an image (JPG, PNG or WEBP)` });
        continue;
      }
      if (file.size > IMAGE_MAX_BYTES) errors.push({ field, message: `${field} must not exceed 3 MB` });
    }
    for (const field of PDF_ONLY_FIELDS) {
      const fileArr = req.files[field];
      if (!fileArr || !fileArr[0]) continue;
      const file = fileArr[0];
      if (!PDF_MIME_TYPES.includes(file.mimetype || "")) {
        errors.push({ field, message: `${field} must be a PDF file` });
        continue;
      }
      if (file.size > PDF_MAX_BYTES) errors.push({ field, message: `${field} must not exceed 2 MB` });
    }
    if (errors.length) return res.status(400).json({ success: false, message: "File validation failed", errors });
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "File validation error" });
  }
}

// ==================== VALIDATION RULES ====================
const rules = () => [
  body("studentId").trim().notEmpty().withMessage("Student ID required"),
  body("admissionNumber").trim().notEmpty().withMessage("Admission Number required"),
  body("admissionDate").isISO8601().withMessage("Valid admission date required"),
  body("name").trim().notEmpty().withMessage("Name required"),
  body("fatherName").trim().notEmpty().withMessage("Father name required"),
  body("motherName").trim().notEmpty().withMessage("Mother name required"),
  body("dob").isISO8601().withMessage("Valid DOB required"),
  body("aadharNumber").custom((v) => {
    const a = normalizeAadhaar(v);
    if (!/^\d{12}$/.test(a)) throw new Error("Aadhaar must be 12 digits");
    if (!hasValidAadhaarStart(a)) throw new Error("Aadhaar cannot start with 0 or 1");
    if (!validateVerhoeff(a)) throw new Error("Invalid Aadhaar (checksum failed)");
    return true;
  }),
  body("apaarId").custom((v) => {
    const a = String(v || "").replace(/\s/g, "");
    if (!/^\d{12}$/.test(a)) throw new Error("APAAR ID must be exactly 12 digits");
    return true;
  }),
  body("class").notEmpty().withMessage("Class required"),
  body("rollNumber").notEmpty().withMessage("Roll number required"),
  body("session").matches(/^\d{4}-\d{2,4}$/).withMessage("Session format YYYY-YY"),
  body("mobileNumber").matches(/^[6-9]\d{9}$/).withMessage("Invalid mobile number"),
  body("emailId").isEmail().withMessage("Invalid email"),
  body("gender").isIn(["Male", "Female", "Other"]).withMessage("Gender required"),
  body("category").isIn(["General", "SC", "ST", "OBC", "EWS", "Other"]).withMessage("Category required"),
  body("address").trim().notEmpty().withMessage("Address required"),
  body("pincode").matches(/^\d{6}$/).withMessage("Pincode must be 6 digits"),
  body("village").trim().notEmpty().withMessage("Village required"),
  body("postOffice").trim().notEmpty().withMessage("Post Office required"),
  body("tehsil").trim().notEmpty().withMessage("Tehsil required"),
  body("district").trim().notEmpty().withMessage("District required"),
  body("state").trim().notEmpty().withMessage("State required")
];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false, message: "Validation failed",
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

const destroyAsset = async (publicId, url) => {
  if (!publicId) return;
  const resourceType = (url || "").includes("/raw/") ? "raw" : "image";
  try { await cloudinary.uploader.destroy(publicId, { resource_type: resourceType }); } catch (e) {}
};

// ============================================================
// ✅ OTP ROUTES
// ============================================================
router.post("/send-email-otp", async (req, res) => {
  try {
    const { email, purpose = "verify", excludeStudentId } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Valid email required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await q(
      `SELECT id, name, student_id FROM Nstudent WHERE LOWER(email_id) = ? ${excludeStudentId ? "AND id != ?" : ""}`,
      excludeStudentId ? [normalizedEmail, excludeStudentId] : [normalizedEmail]
    );
    if (existing.length >= EMAIL_MAX_STUDENTS) {
      return res.status(409).json({
        success: false,
        message: `This email is already registered with student: ${existing[0].name} (${existing[0].student_id}).`,
        code: "EMAIL_ALREADY_REGISTERED",
        existingStudent: existing[0]
      });
    }

    const otp = generateOTP();
    await saveOTP("email", normalizedEmail, otp, purpose);
    console.log(`📧 Email OTP for ${normalizedEmail}: ${otp}`);

    try { await sendEmailOTP(normalizedEmail, otp, purpose); }
    catch (err) {
      console.error("Email send error:", err.message);
      return res.status(500).json({ success: false, message: "OTP generated but email failed. Check config." });
    }
    res.json({ success: true, message: "OTP sent to your email ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/verify-email-otp", async (req, res) => {
  try {
    const { email, otp, purpose } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: "Email and OTP required" });
    const normalizedEmail = email.toLowerCase().trim();
    const result = await verifyOTP("email", normalizedEmail, otp, purpose || "verify");

    if (!result.valid) {
      const attemptsLeft = result.attempts ? (OTP_MAX_ATTEMPTS - result.attempts) : OTP_MAX_ATTEMPTS;
      const messages = {
        NO_OTP_OR_EXPIRED: "OTP expired or not found. Please request a new one.",
        INVALID_OTP: `Invalid OTP. ${attemptsLeft} attempts left.`,
        TOO_MANY_ATTEMPTS: "Too many wrong attempts. Please request a new OTP."
      };
      return res.status(400).json({ success: false, message: messages[result.reason] || "Verification failed", code: result.reason });
    }
    res.json({ success: true, message: "Email verified ✅", verified: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ CHECK MOBILE
// ============================================================
router.post("/check-mobile", async (req, res) => {
  try {
    const { mobile, excludeStudentId } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: "Valid 10-digit mobile required" });
    }
    const rows = await q(
      `SELECT id, student_id, admission_number, name, father_name, class, session, status
       FROM Nstudent WHERE mobile_number = ? ${excludeStudentId ? "AND id != ?" : ""} ORDER BY id ASC`,
      excludeStudentId ? [mobile, excludeStudentId] : [mobile]
    );
    const limit = MOBILE_MAX_STUDENTS;
    const used = rows.length;
    const remaining = Math.max(0, limit - used);

    res.json({
      success: true, mobile, used, limit, remaining, canUse: used < limit,
      students: rows.map(r => ({
        id: r.id, studentId: r.student_id, admissionNumber: r.admission_number,
        name: r.name, fatherName: r.father_name, class: r.class, session: r.session, status: r.status
      })),
      message: used === 0 ? "Mobile number available ✅"
        : used >= limit ? `Mobile already used by ${limit} students. Cannot add more.`
        : `Mobile used by ${used} student(s). ${remaining} slot(s) remaining.`
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// ✅ CHECK APAAR
// ============================================================
router.post("/check-apaar", async (req, res) => {
  try {
    const { apaarId, excludeStudentId } = req.body;
    if (!apaarId) return res.status(400).json({ success: false, message: "APAAR ID required" });
    const cleaned = String(apaarId).replace(/\s/g, "");
    if (!/^\d{12}$/.test(cleaned)) {
      return res.status(400).json({ success: false, available: false, message: "APAAR ID must be exactly 12 digits" });
    }
    const rows = await q(
      `SELECT id, student_id, admission_number, name, father_name, class
       FROM Nstudent WHERE apaar_id = ? ${excludeStudentId ? "AND id != ?" : ""} LIMIT 5`,
      excludeStudentId ? [cleaned, excludeStudentId] : [cleaned]
    );
    if (rows.length > 0) {
      const r = rows[0];
      return res.json({
        success: true, available: false, taken: true,
        existingStudent: {
          id: r.id, studentId: r.student_id, admissionNumber: r.admission_number,
          name: r.name, fatherName: r.father_name, class: r.class
        },
        message: `APAAR ID already registered with ${r.name} (${r.student_id})`
      });
    }
    res.json({ success: true, available: true, taken: false, message: "APAAR ID available ✅" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// ✅ VERIFY AADHAAR
// ============================================================
router.post("/verify-aadhaar", async (req, res) => {
  try {
    const { aadharNumber, name, fatherName, dob, excludeStudentId } = req.body;
    if (!aadharNumber) return res.status(400).json({ success: false, verified: false, message: "Aadhaar required" });
    const aadhaar12 = normalizeAadhaar(aadharNumber);

    if (!/^\d{12}$/.test(aadhaar12)) return res.status(400).json({ success: false, verified: false, code: "INVALID_LENGTH", message: "Aadhaar must be exactly 12 digits" });
    if (!hasValidAadhaarStart(aadhaar12)) return res.status(400).json({ success: false, verified: false, code: "INVALID_START", message: "Aadhaar cannot start with 0 or 1" });
    if (!validateVerhoeff(aadhaar12)) return res.status(400).json({ success: false, verified: false, code: "CHECKSUM_FAILED", message: "Invalid Aadhaar (checksum failed)" });
    if (/^(\d)\1{11}$/.test(aadhaar12)) return res.status(400).json({ success: false, verified: false, code: "ALL_SAME_DIGITS", message: "Aadhaar cannot have all identical digits" });

    const existingRows = await q(
      `SELECT id, name, father_name, dob, student_id, admission_number, class, mobile_number
       FROM Nstudent WHERE aadhar_number = ? ${excludeStudentId ? "AND id != ?" : ""} LIMIT 5`,
      excludeStudentId ? [aadhaar12, excludeStudentId] : [aadhaar12]
    );

    let nameMatch = null;
    if (name && name.trim() && existingRows.length > 0) {
      const rec = existingRows[0];
      nameMatch = {
        against: "existing_record", studentId: rec.student_id,
        nameMatches: (rec.name || "").toLowerCase() === name.trim().toLowerCase(),
        fatherMatches: fatherName ? (rec.father_name || "").toLowerCase() === fatherName.trim().toLowerCase() : null,
        dobMatches: dob ? new Date(rec.dob).toISOString().slice(0, 10) === dob.slice(0, 10) : null
      };
    }

    res.json({
      success: true, verified: true,
      aadhaar: { formatted: aadhaar12.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3"), last4: aadhaar12.slice(-4), valid: true },
      alreadyExists: existingRows.length > 0,
      existingRecord: existingRows[0] || null,
      existingStudents: existingRows.map(r => ({ id: r.id, studentId: r.student_id, name: r.name, class: r.class })),
      nameMatch,
      message: existingRows.length > 0 ? `Aadhaar valid but already registered with ${existingRows[0].name}` : "Aadhaar verified ✅"
    });
  } catch (err) { res.status(500).json({ success: false, verified: false, message: err.message }); }
});

// ============================================================
// GET ALL
// ============================================================
router.get("/", async (req, res) => {
  try {
    await autoRevertExpiredPromotions();
    const { class: cls, session, gender, category, status, search, sortBy = "created_at", order = "desc", page = 1, limit = 20 } = req.query;
    const allowedSort = ["created_at", "name", "class", "roll_number", "admission_date", "admission_number"];
    const sortCol = allowedSort.includes(sortBy) ? sortBy : "created_at";
    const sortDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    const where = [];
    const params = [];
    if (cls)      { where.push("class = ?"); params.push(cls); }
    if (session)  { where.push("session = ?"); params.push(session); }
    if (gender)   { where.push("gender = ?"); params.push(gender); }
    if (category) { where.push("category = ?"); params.push(category); }
    if (status)   { where.push("status = ?"); params.push(status); }
    if (search) {
      where.push("(name LIKE ? OR admission_number LIKE ? OR student_id LIKE ? OR father_name LIKE ? OR mobile_number LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const offset = (Number(page) - 1) * Number(limit);

    const rows = await q(
      `SELECT * FROM Nstudent ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const countRows = await q(`SELECT COUNT(*) AS total FROM Nstudent ${whereSql}`, params);
    const total = countRows[0]?.total || 0;
    const cleaned = rows.map(revertStatusIfExpired);

    res.json({ success: true, data: cleaned, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// SESSION
// ============================================================
router.get("/current-session", async (req, res) => {
  try {
    const rows = await q("SELECT `value` FROM settings WHERE `key` = 'current_session'");
    res.json({ success: true, session: rows[0]?.value || null });
  } catch (err) { res.json({ success: true, session: null }); }
});

router.post("/current-session", async (req, res) => {
  try {
    const { session } = req.body;
    if (!session || !/^\d{4}-\d{2,4}$/.test(session)) {
      return res.status(400).json({ success: false, message: "Invalid session format" });
    }
    await q("INSERT INTO settings (`key`, `value`) VALUES ('current_session', ?) ON DUPLICATE KEY UPDATE `value` = ?", [session, session]);
    res.json({ success: true, message: "Session saved ✅", session });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// GROUP BY CLASS
// ============================================================
router.get("/by-class", async (req, res) => {
  try {
    await autoRevertExpiredPromotions();
    const { session } = req.query;
    const where = session ? "WHERE session = ?" : "";
    const params = session ? [session] : [];
    const rows = await q(
      `SELECT class, COUNT(*) AS count FROM Nstudent ${where}
       GROUP BY class
       ORDER BY FIELD(class,'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// PROMOTE
// ============================================================
router.post("/promote", async (req, res) => {
  try {
    const { studentIds, toClass } = req.body;
    if (!Array.isArray(studentIds) || !studentIds.length || !toClass) {
      return res.status(400).json({ success: false, message: "studentIds[] and toClass required" });
    }
    const updatedCount = await db.transaction(async (conn) => {
      const ph = studentIds.map(() => "?").join(",");
      const [rows] = await conn.query(`SELECT id, class, session FROM Nstudent WHERE id IN (${ph})`, studentIds);
      for (const s of rows) {
        await conn.query(
          `UPDATE Nstudent SET promoted_from = ?, class = ?, session = ?, status = 'Promoted', promotion_date = NOW() WHERE id = ?`,
          [s.class, toClass, incrementSession(s.session), s.id]
        );
      }
      return rows.length;
    });
    res.json({ success: true, message: `${updatedCount} students promoted ✅` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post("/promote-session", async (req, res) => {
  try {
    const { fromSession, toSession } = req.body;
    if (!fromSession || !toSession) return res.status(400).json({ success: false, message: "fromSession and toSession required" });

    const result = await db.transaction(async (conn) => {
      const [rows] = await conn.query(`SELECT id, class FROM Nstudent WHERE session = ? AND status = 'Active'`, [fromSession]);
      let promoted = 0, skipped = 0;
      for (const s of rows) {
        const nxt = nextClass(s.class);
        if (!nxt) { skipped++; continue; }
        await conn.query(
          `UPDATE Nstudent SET promoted_from = ?, class = ?, session = ?, status = 'Promoted', promotion_date = NOW() WHERE id = ?`,
          [s.class, nxt, toSession, s.id]
        );
        promoted++;
      }
      await conn.query("INSERT INTO settings (`key`, `value`) VALUES ('current_session', ?) ON DUPLICATE KEY UPDATE `value` = ?", [toSession, toSession]);
      return { promoted, skipped };
    });

    res.json({ success: true, message: `${result.promoted} promoted ✅`, count: result.promoted, skipped: result.skipped });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// SEARCH
// ============================================================
router.get("/search/:query", async (req, res) => {
  try {
    await autoRevertExpiredPromotions();
    const sq = req.params.query;
    const { limit = 20 } = req.query;
    const rows = await q(
      `SELECT * FROM Nstudent WHERE name LIKE ? OR admission_number LIKE ? OR student_id LIKE ? OR father_name LIKE ? ORDER BY id DESC LIMIT ?`,
      [`%${sq}%`, `%${sq}%`, `%${sq}%`, `%${sq}%`, parseInt(limit)]
    );
    res.json({ success: true, data: rows.map(revertStatusIfExpired) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// ✅ ADD STUDENT (with welcome email)
// ============================================================
router.post(
  "/add",
  studentUploadFields,
  validateUploadedFiles,
  rules(),
  validate,
  async (req, res) => {
    try {
      const category = req.body.category;
      const email = String(req.body.emailId || "").toLowerCase().trim();
      const mobile = String(req.body.mobileNumber || "").trim();
      const emailVerified = String(req.body.emailVerified) === "true";

      if (!emailVerified) {
        return res.status(400).json({ success: false, message: "Email must be OTP-verified before adding student.", code: "EMAIL_NOT_VERIFIED" });
      }

      const emailVerifiedRec = await q(
        `SELECT id FROM student_otps WHERE type='email' AND target=? AND verified=1 AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1`,
        [email]
      );
      if (!emailVerifiedRec.length) {
        return res.status(400).json({ success: false, message: "Email verification expired. Please verify again.", code: "OTP_EXPIRED" });
      }

      // Uniqueness
      const emailDup = await q(`SELECT id, name, student_id FROM Nstudent WHERE LOWER(email_id) = ?`, [email]);
      if (emailDup.length >= EMAIL_MAX_STUDENTS) {
        return res.status(409).json({ success: false, message: `Email already registered with ${emailDup[0].name}`, code: "EMAIL_ALREADY_REGISTERED" });
      }
      const mobileDup = await q(`SELECT id, name, student_id FROM Nstudent WHERE mobile_number = ?`, [mobile]);
      if (mobileDup.length >= MOBILE_MAX_STUDENTS) {
        return res.status(409).json({ success: false, message: `Mobile already linked to ${MOBILE_MAX_STUDENTS} students`, code: "MOBILE_LIMIT_REACHED" });
      }

      const apaarVal = String(req.body.apaarId || "").replace(/\s/g, "");
      if (apaarVal) {
        const apaarDup = await q(`SELECT id, name, student_id FROM Nstudent WHERE apaar_id = ?`, [apaarVal]);
        if (apaarDup.length > 0) {
          return res.status(409).json({ success: false, message: `APAAR ID already registered with ${apaarDup[0].name}`, code: "APAAR_ALREADY_REGISTERED" });
        }
      }

      // Required docs
      const requiredDocs = getRequiredDocs(category);
      const missing = [];
      for (const docName of requiredDocs) {
        if (!req.files || !req.files[docName] || !req.files[docName][0]) {
          missing.push(docName.replace(/([A-Z])/g, " $1").trim());
        }
      }
      if (missing.length) {
        return res.status(400).json({ success: false, message: `Missing required documents: ${missing.join(", ")}`, category, requiredDocuments: requiredDocs });
      }

      // Drop caste cert for General
      const files = req.files ? { ...req.files } : {};
      if (!CASTE_REQUIRED_CATEGORIES.includes(category) && files.casteCertificate) {
        const df = files.casteCertificate[0];
        if (df?.filename) try { await cloudinary.uploader.destroy(df.filename); } catch (e) {}
        delete files.casteCertificate;
      }

      const bodyData = { ...req.body };
      if (bodyData.aadharNumber) bodyData.aadharNumber = normalizeAadhaar(bodyData.aadharNumber);
      if (bodyData.apaarId) bodyData.apaarId = String(bodyData.apaarId).replace(/\s/g, "");
      delete bodyData.emailVerified;

      const data = { ...pickBody(bodyData), ...extractFiles(files) };
      if (!data.status) data.status = "Active";
      data.email_verified = 1;

      const cols = Object.keys(data);
      const vals = Object.values(data);
      const ph = cols.map(() => "?").join(",");

      let result;
      try {
        result = await q(`INSERT INTO Nstudent (${cols.join(",")}) VALUES (${ph})`, vals);
      } catch (insertErr) {
        if (insertErr.message && insertErr.message.includes("Unknown column")) {
          delete data.email_verified;
          const c2 = Object.keys(data);
          const v2 = Object.values(data);
          const p2 = c2.map(() => "?").join(",");
          result = await q(`INSERT INTO Nstudent (${c2.join(",")}) VALUES (${p2})`, v2);
        } else throw insertErr;
      }

      const savedStudent = (await q("SELECT * FROM Nstudent WHERE id = ?", [result.insertId]))[0];

      // ✅ Send welcome email async (don't block response)
      (async () => {
        try {
          console.log(`📧 Generating welcome PDF for ${savedStudent.name}...`);
          const pdfBuffer = await generateWelcomePDF(savedStudent);
          console.log(`📧 Sending welcome email to ${savedStudent.email_id}...`);
          await sendRegistrationSuccessEmail(savedStudent, pdfBuffer);
          console.log(`✅ Welcome email sent to ${savedStudent.email_id}`);
        } catch (emailErr) {
          console.error("❌ Welcome email error:", emailErr.message);
        }
      })();

      res.status(201).json({
        success: true,
        message: "Student added successfully ✅ Registration email is being sent...",
        data: savedStudent,
        student: savedStudent
      });
    } catch (err) {
      console.error("❌ Add Student Error:", err);
      if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ success: false, message: "Student ID or Admission Number already exists" });
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ============================================================
// GET SINGLE
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });
    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
    const student = revertStatusIfExpired(rows[0]);
    res.json({ success: true, data: student, student });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// UPDATE
// ============================================================
router.put(
  "/:id",
  studentUploadFields,
  validateUploadedFiles,
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

      const existingRows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
      if (!existingRows.length) return res.status(404).json({ success: false, message: "Not found" });
      const existing = existingRows[0];

      const newEmail = String(req.body.emailId || existing.email_id || "").toLowerCase().trim();
      const newMobile = String(req.body.mobileNumber || existing.mobile_number || "").trim();
      const newApaar = String(req.body.apaarId || existing.apaar_id || "").replace(/\s/g, "");

      const emailChanged = newEmail !== (existing.email_id || "").toLowerCase().trim();
      const mobileChanged = newMobile !== (existing.mobile_number || "").trim();
      const apaarChanged = newApaar !== (existing.apaar_id || "").replace(/\s/g, "").trim();

      if (emailChanged) {
        const dup = await q(`SELECT id, name, student_id FROM Nstudent WHERE LOWER(email_id) = ? AND id != ?`, [newEmail, id]);
        if (dup.length >= EMAIL_MAX_STUDENTS) return res.status(409).json({ success: false, message: `Email already registered with ${dup[0].name}`, code: "EMAIL_ALREADY_REGISTERED" });
        const v = await q(`SELECT id FROM student_otps WHERE type='email' AND target=? AND verified=1 AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) LIMIT 1`, [newEmail]);
        if (!v.length) return res.status(400).json({ success: false, message: "New email must be OTP-verified", code: "EMAIL_NOT_VERIFIED" });
      }
      if (mobileChanged) {
        const dup = await q(`SELECT id, name, student_id FROM Nstudent WHERE mobile_number = ? AND id != ?`, [newMobile, id]);
        if (dup.length >= MOBILE_MAX_STUDENTS) return res.status(409).json({ success: false, message: `Mobile limit reached`, code: "MOBILE_LIMIT_REACHED" });
      }
      if (apaarChanged && newApaar) {
        const dup = await q(`SELECT id, name, student_id FROM Nstudent WHERE apaar_id = ? AND id != ?`, [newApaar, id]);
        if (dup.length > 0) return res.status(409).json({ success: false, message: `APAAR ID already registered`, code: "APAAR_ALREADY_REGISTERED" });
      }

      const finalCategory = req.body.category || existing.category;
      const needsCaste = CASTE_REQUIRED_CATEGORIES.includes(finalCategory);
      const hasNewCaste = req.files?.casteCertificate?.[0];
      const hasOldCaste = existing.caste_certificate_url;
      if (needsCaste && !hasNewCaste && !hasOldCaste) {
        return res.status(400).json({ success: false, message: `Caste Certificate required for ${finalCategory}` });
      }

      if (req.body.aadharNumber !== undefined) {
        const a = normalizeAadhaar(req.body.aadharNumber);
        if (!/^\d{12}$/.test(a) || !hasValidAadhaarStart(a) || !validateVerhoeff(a)) {
          return res.status(400).json({ success: false, message: "Invalid Aadhaar number" });
        }
        req.body.aadharNumber = a;
      }
      if (req.body.apaarId !== undefined) {
        const pa = String(req.body.apaarId).replace(/\s/g, "");
        if (!/^\d{12}$/.test(pa)) return res.status(400).json({ success: false, message: "APAAR must be 12 digits" });
        req.body.apaarId = pa;
      }

      const newFiles = extractFiles(req.files);
      if (!needsCaste && newFiles.caste_certificate_url) {
        const dp = newFiles.caste_certificate_pid;
        if (dp) try { await cloudinary.uploader.destroy(dp); } catch (e) {}
        delete newFiles.caste_certificate_url;
        delete newFiles.caste_certificate_pid;
      }
      for (const f of DOC_FIELDS) {
        const snake = toSnake(f);
        const newPid = newFiles[`${snake}_pid`];
        const oldPid = existing[`${snake}_pid`];
        if (newPid && oldPid) await destroyAsset(oldPid, existing[`${snake}_url`]);
      }

      const cleanBody = { ...req.body };
      delete cleanBody.emailVerified;

      const data = { ...pickBody(cleanBody), ...newFiles };
      const cols = Object.keys(data);
      if (!cols.length) return res.json({ success: true, message: "No changes", data: existing });

      const setSql = cols.map(c => `${c} = ?`).join(", ");
      await q(`UPDATE Nstudent SET ${setSql} WHERE id = ?`, [...Object.values(data), id]);

      const updated = (await q("SELECT * FROM Nstudent WHERE id = ?", [id]))[0];
      res.json({ success: true, message: "Student updated ✅", data: revertStatusIfExpired(updated), student: revertStatusIfExpired(updated) });
    } catch (err) {
      console.error("❌ Update error:", err);
      if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ success: false, message: "Duplicate entry" });
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ============================================================
// DELETE
// ============================================================
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });
    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
    const s = rows[0];
    for (const f of DOC_FIELDS) {
      const snake = toSnake(f);
      if (s[`${snake}_pid`]) await destroyAsset(s[`${snake}_pid`], s[`${snake}_url`]);
    }
    await q("DELETE FROM Nstudent WHERE id = ?", [id]);
    res.json({ success: true, message: "Deleted ✅" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ============================================================
// PDF PROXY (Cloudinary PDF access fix)
// ============================================================
router.get("/proxy-pdf", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "URL required" });
    if (!url.includes("res.cloudinary.com")) return res.status(400).json({ success: false, message: "Only Cloudinary URLs allowed" });

    const client = url.startsWith("https") ? https : http;
    client.get(url, (remoteRes) => {
      if (remoteRes.statusCode !== 200) {
        return res.status(remoteRes.statusCode).json({ success: false, message: `Cloudinary error: ${remoteRes.statusCode}` });
      }
      res.setHeader("Content-Type", remoteRes.headers["content-type"] || "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "public, max-age=3600");
      remoteRes.pipe(res);
    }).on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PDF
// ============================================================
router.get("/:id/pdf", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });
    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
    const s = revertStatusIfExpired(rows[0]);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${s.admission_number || "student"}.pdf"`);
    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, 80).fill("#1e3a8a");
    doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text("STUDENT ADMISSION RECORD", 40, 25, { align: "center" });
    doc.fontSize(10).font("Helvetica").text("Official Document", 40, 55, { align: "center" });
    doc.fillColor("#000000");

    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const px = doc.page.width - 150, py = 110;
    if (photoBuf) { try { doc.image(photoBuf, px, py, { width: 100, height: 120 }); } catch (e) {} }
    else { doc.rect(px, py, 100, 120).stroke(); doc.fontSize(9).fillColor("#666").text("No Photo", px + 25, py + 55); }

    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a8a").text("Personal Details", 40, 110);
    doc.moveTo(40, 130).lineTo(400, 130).stroke("#1e3a8a");
    doc.y = 145;
    const row = (label, value) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e3a8a").text(`${label}: `, { continued: true });
      doc.font("Helvetica").fillColor("#000").text(String(value ?? "-"));
    };
    row("Student ID", s.student_id);
    row("Admission Number", s.admission_number);
    row("Admission Date", s.admission_date);
    row("Full Name", s.name);
    row("Father Name", s.father_name);
    row("Mother Name", s.mother_name);
    row("Date of Birth", s.dob);
    row("Gender", s.gender);
    row("Category", s.category);
    row("Aadhar Number", s.aadhar_number);
    row("APAAR ID", s.apaar_id);
    row("Mobile", s.mobile_number);
    row("Email", s.email_id);

    doc.moveDown(1.5);
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a8a").text("Academic Details");
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke("#1e3a8a");
    doc.moveDown(0.6);
    row("Class", s.class);
    row("Roll Number", s.roll_number);
    row("Session", s.session);
    row("Status", s.status);

    doc.moveDown(1.5);
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a8a").text("Address");
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke("#1e3a8a");
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(10).fillColor("#000").text(s.address || "-");

    doc.fontSize(8).fillColor("#666").text(`Generated on ${new Date().toLocaleString("en-IN")}`, 40, doc.page.height - 40, { align: "center" });
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT LOGIN VERIFY
// ============================================================
router.post("/verify-login", async (req, res) => {
  try {
    const { class: cls, studentId, apaarId, dob } = req.body;
    if (!cls || !studentId || !apaarId || !dob) return res.status(400).json({ success: false, message: "All fields required" });
    if (!/^\d{12}$/.test(apaarId)) return res.status(400).json({ success: false, message: "APAAR ID must be 12 digits" });

    const rows = await q(
      `SELECT * FROM Nstudent WHERE class = ? AND student_id = ? AND apaar_id = ? AND DATE(dob) = DATE(?) LIMIT 1`,
      [cls, studentId, apaarId, dob]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const s = revertStatusIfExpired(rows[0]);
    const token = Buffer.from(`${s.id}-${Date.now()}`).toString("base64");
    const safeStudent = { ...s };
    for (const k of Object.keys(safeStudent)) if (k.endsWith("_pid")) delete safeStudent[k];

    res.json({ success: true, message: "Login successful ✅", student: safeStudent, token });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
