const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const path = require("path");

const db = require("../config/db");
const { cloudinary, uploadStudent } = require("../config/cloudinary");
// ============================================================
// ✅ PIN SYSTEM — Constants & Helpers
// ============================================================
const crypto = require("crypto");

const PIN_LENGTH = 6;
const MAX_CHANGES_PER_MONTH = 3;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000;     // 30 minutes
const PIN_OTP_EXPIRY_MS = 10 * 60 * 1000;    // 10 minutes
const PIN_OTP_MAX_ATTEMPTS = 5;

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function validatePin(pin) {
  if (!pin || typeof pin !== "string") return "PIN required";
  if (!/^\d{6}$/.test(pin)) return "PIN must be exactly 6 digits";
  if (/^(\d)\1{5}$/.test(pin)) return "PIN cannot be all same digits (e.g. 111111)";
  if (/^(012345|123456|234567|345678|456789|987654|654321|543210)$/.test(pin)) {
    return "PIN cannot be a simple sequence";
  }
  return null;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 64).toString("hex");
}

function generatePinSalt() {
  return crypto.randomBytes(32).toString("hex");
}

function safeCompareHex(a, b) {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

function genPinOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function logPinHistory(studentId, action, changedBy, req) {
  try {
    await q(
      `INSERT INTO student_pin_history (student_id, action, changed_by, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [
        studentId,
        action,
        changedBy,
        (req.headers["x-forwarded-for"] || req.ip || "").toString().slice(0, 45),
        (req.headers["user-agent"] || "").toString().slice(0, 255)
      ]
    );
  } catch (e) {
    console.error("PIN history log error:", e.message);
  }
}
// ============================================================
// ✅ END PIN SYSTEM HELPERS
// ============================================================

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
// ✅ REGISTRATION SUCCESS EMAIL
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

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr><td align="center">
        <a href="${loginUrl}" style="display:inline-block; padding: 16px 48px; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color:#fff; text-decoration:none; border-radius:50px; font-weight:800; font-size:15px; letter-spacing:1px; box-shadow: 0 8px 24px rgba(79,70,229,0.4);">
          🚀 Login to Student Portal
        </a>
      </td></tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:14px; margin-bottom: 24px;">
      <tr><td style="padding: 16px 20px;">
        <p style="margin:0; color:#166534; font-size:13px; line-height:1.6;">
          📎 <b>Attachment:</b> Your <b>Provisional Registration Form</b> is attached with this email. Please download and save it for your records.
        </p>
      </td></tr>
    </table>

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
// ✅ WELCOME PDF GENERATOR
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

      // Watermark
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

      // Header
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

      // Title
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

      // Photo box
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

      y += 8;
      const sectionTitle = (text) => {
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a").text(text, ML, y);
        doc.moveTo(ML, y + 16).lineTo(ML + 30, y + 16).lineWidth(2).strokeColor("#c9972b").stroke();
        y += 22;
      };

      const drawFullRow = (label, value) => {
        const rowH = 20;
        doc.rect(ML, y, 160, rowH).fillColor("#fef8ed").fill();
        doc.rect(ML, y, 160, rowH).lineWidth(0.4).strokeColor("#c9972b").stroke();
        doc.rect(ML + 160, y, contentW - 160, rowH).lineWidth(0.4).strokeColor("#94a3b8").stroke();
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0d1b2a").text(label, ML + 6, y + 6, { width: 148 });
        doc.font("Helvetica").fontSize(10).fillColor("#1a2332").text(String(value || "—"), ML + 168, y + 6, { width: contentW - 176, lineBreak: false });
        y += rowH;
      };

      sectionTitle("Personal Details");
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

      // Login credentials box
      y += 12;
      const credBoxH = 95;
      if (y + credBoxH < pageH - 150) {
        doc.roundedRect(ML, y, contentW, credBoxH, 8).fillColor("#fef3c7").fill();
        doc.roundedRect(ML, y, contentW, credBoxH, 8).lineWidth(1.5).strokeColor("#f59e0b").stroke();

        doc.font("Helvetica-Bold").fontSize(11).fillColor("#92400e")
           .text("LOGIN CREDENTIALS — KEEP SAFE", ML + 14, y + 12);
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

      // Signature
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
// ✅ PDF PROXY — Cloudinary /raw/ PDF view fix
// ⚠️ IMPORTANT: Ye route /:id se PEHLE hona chahiye
// ============================================================
router.get("/proxy-pdf", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "URL required" });
    if (!url.includes("res.cloudinary.com")) return res.status(400).json({ success: false, message: "Only Cloudinary URLs allowed" });

    const client = url.startsWith("https") ? https : http;
    client.get(url, (remoteRes) => {
      if ([301, 302, 307, 308].includes(remoteRes.statusCode) && remoteRes.headers.location) {
        remoteRes.resume();
        return res.redirect(remoteRes.headers.location);
      }
      if (remoteRes.statusCode !== 200) {
        remoteRes.resume();
        return res.status(remoteRes.statusCode).json({
          success: false,
          message: `Cloudinary returned ${remoteRes.statusCode}`
        });
      }

      let contentType = remoteRes.headers["content-type"] || "";
      const urlLower = url.toLowerCase();
      if (urlLower.endsWith(".pdf") || contentType.includes("pdf")) {
        contentType = "application/pdf";
      } else if (!contentType) {
        contentType = "application/octet-stream";
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      remoteRes.pipe(res);
    }).on("error", (err) => {
      console.error("❌ Proxy PDF error:", err.message);
      if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    });
  } catch (err) {
    console.error("❌ Proxy catch error:", err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ GET ALL
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
// ✅ SESSION
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
// ✅ GROUP BY CLASS
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
// ✅ PROMOTE
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
// ✅ SEARCH
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
// ✅ ADD STUDENT
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
// ✅ GET SINGLE
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
// ✅ UPDATE
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
// ✅ DELETE
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
// ✅ STUDENT PDF (full admission record)
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
// ✅ STUDENT LOGIN VERIFY
// ============================================================
// ============================================================
// ✅ STUDENT LOGIN VERIFY (Email + Student ID)
// ============================================================
router.post("/verify-login", async (req, res) => {
  try {
    const { email, studentId } = req.body;

    // ---- Validation ----
    if (!email || !studentId) {
      return res.status(400).json({
        success: false,
        message: "Email and Student ID are required"
      });
    }

    const emailClean = String(email).toLowerCase().trim();
    const sidClean = String(studentId).trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address"
      });
    }

    if (sidClean.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Student ID must be at least 3 characters"
      });
    }

    // ---- DB Lookup: Email + Student ID (case-insensitive) ----
    const rows = await q(
      `SELECT * FROM Nstudent 
       WHERE LOWER(email_id) = ? AND LOWER(student_id) = ? 
       LIMIT 1`,
      [emailClean, sidClean.toLowerCase()]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or Student ID. Please check your details."
      });
    }

    const s = revertStatusIfExpired(rows[0]);

    // ---- Block inactive/suspended students (optional) ----
    if (s.status && s.status.toLowerCase() === "inactive") {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Please contact the school office."
      });
    }

    // ---- Generate session token ----
    const token = Buffer.from(`${s.id}-${Date.now()}-${Math.random()}`).toString("base64");

    // ---- Remove sensitive internal fields before sending ----
    const safeStudent = { ...s };
    for (const k of Object.keys(safeStudent)) {
      if (k.endsWith("_pid")) delete safeStudent[k];
      if (k === "aadhar_number") delete safeStudent[k];  // optional
    }

    res.json({
      success: true,
      message: "Login successful ✅",
      student: safeStudent,
      token,
      loginTime: new Date().toISOString()
    });

  } catch (err) {
    console.error("❌ Verify-login error:", err.message);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});
    // ============================================================
// ✅ RECOVER CREDENTIAL (Email or Student ID)
// ============================================================
router.post("/recover-credential", async (req, res) => {
  try {
    const { recoverType } = req.body;

    // ---- Validation ----
    if (!recoverType || !["email", "studentId"].includes(recoverType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid recovery type"
      });
    }

    // ========== RECOVER EMAIL ==========
    if (recoverType === "email") {
      const { class: cls, studentId, apaarId, dob, motherName } = req.body;

      if (!cls || !studentId || !apaarId || !dob || !motherName) {
        return res.status(400).json({
          success: false,
          message: "All fields required"
        });
      }

      if (!/^\d{12}$/.test(String(apaarId).replace(/\s/g, ""))) {
        return res.status(400).json({
          success: false,
          message: "APAAR ID must be 12 digits"
        });
      }

      const rows = await q(
        `SELECT id, name, father_name, class, student_id, email_id
         FROM Nstudent 
         WHERE class = ? 
           AND LOWER(student_id) = LOWER(?)
           AND apaar_id = ?
           AND DATE(dob) = DATE(?)
           AND LOWER(mother_name) = LOWER(?)
         LIMIT 1`,
        [
          cls,
          String(studentId).trim(),
          String(apaarId).replace(/\s/g, "").trim(),
          dob,
          String(motherName).trim()
        ]
      );

      if (!rows.length) {
        return res.status(401).json({
          success: false,
          message: "No matching record found. Please check your details."
        });
      }

      const s = rows[0];

      // Only return safe fields
      return res.json({
        success: true,
        student: {
          class: s.class,
          name: s.name,
          fatherName: s.father_name,
          email: s.email_id
        }
      });
    }

    // ========== RECOVER STUDENT ID ==========
    if (recoverType === "studentId") {
      const { class: cls, email, aadharNumber, dob, fatherName } = req.body;

      if (!cls || !email || !aadharNumber || !dob || !fatherName) {
        return res.status(400).json({
          success: false,
          message: "All fields required"
        });
      }

      const aadhaar = String(aadharNumber).replace(/[\s-]/g, "");
      if (!/^\d{12}$/.test(aadhaar)) {
        return res.status(400).json({
          success: false,
          message: "Aadhaar must be 12 digits"
        });
      }

      const rows = await q(
        `SELECT id, name, father_name, class, student_id, email_id
         FROM Nstudent 
         WHERE class = ?
           AND LOWER(email_id) = LOWER(?)
           AND aadhar_number = ?
           AND DATE(dob) = DATE(?)
           AND LOWER(father_name) = LOWER(?)
         LIMIT 1`,
        [
          cls,
          String(email).trim(),
          aadhaar,
          dob,
          String(fatherName).trim()
        ]
      );

      if (!rows.length) {
        return res.status(401).json({
          success: false,
          message: "No matching record found. Please check your details."
        });
      }

      const s = rows[0];

      return res.json({
        success: true,
        student: {
          class: s.class,
          name: s.name,
          fatherName: s.father_name,
          studentId: s.student_id
        }
      });
    }

    return res.status(400).json({ success: false, message: "Unknown recovery type" });

  } catch (err) {
    console.error("❌ recover-credential error:", err.message);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});
// ============================================================
// ============================================================
// ✅ ====== STUDENT 6-DIGIT PIN SYSTEM (ROUTES) ======
// ============================================================
// ============================================================

// ============================================================
// ✅ PIN STATUS — Check if student has PIN / needs monthly change
// ============================================================
router.get("/pin/status/:studentId", async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId);
    if (!studentId) return res.status(400).json({ success: false, message: "Invalid student ID" });

    const rows = await q(
      `SELECT student_id, last_changed_at, change_count_this_month, month_year, locked_until, failed_attempts
       FROM student_pins WHERE student_id = ?`,
      [studentId]
    );

    const thisMonth = currentMonthYear();

    if (!rows.length) {
      return res.json({
        success: true,
        hasPin: false,
        needsChange: true,
        message: "No PIN set. Please create one to secure your account."
      });
    }

    const r = rows[0];
    const locked = r.locked_until && new Date(r.locked_until) > new Date();
    const monthChanged = r.month_year !== thisMonth;
    const changesUsed = monthChanged ? 0 : r.change_count_this_month;
    const remaining = Math.max(0, MAX_CHANGES_PER_MONTH - changesUsed);
    const needsChange = monthChanged;   // last month ka hai → change zaroori

    res.json({
      success: true,
      hasPin: true,
      locked,
      lockedUntil: r.locked_until,
      failedAttempts: r.failed_attempts || 0,
      lastChangedAt: r.last_changed_at,
      changesUsed,
      changesRemaining: remaining,
      maxChangesPerMonth: MAX_CHANGES_PER_MONTH,
      needsChange,
      monthYear: thisMonth
    });
  } catch (err) {
    console.error("PIN status error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ CREATE PIN (first time only)
// ============================================================
router.post("/pin/create", async (req, res) => {
  try {
    const { studentId, pin, confirmPin } = req.body;

    if (!studentId || !pin || !confirmPin) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const sid = parseInt(studentId);
    if (pin !== confirmPin) {
      return res.status(400).json({ success: false, message: "PIN and Confirm PIN do not match" });
    }

    const pinErr = validatePin(pin);
    if (pinErr) return res.status(400).json({ success: false, message: pinErr });

    const stu = await q(`SELECT id, name FROM Nstudent WHERE id = ?`, [sid]);
    if (!stu.length) return res.status(404).json({ success: false, message: "Student not found" });

    const existing = await q(`SELECT id FROM student_pins WHERE student_id = ?`, [sid]);
    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "PIN already exists. Use 'Change PIN' instead."
      });
    }

    const salt = generatePinSalt();
    const hash = hashPin(pin, salt);
    const thisMonth = currentMonthYear();

    await q(
      `INSERT INTO student_pins 
       (student_id, pin_hash, pin_salt, last_changed_at, change_count_this_month, month_year)
       VALUES (?, ?, ?, NOW(), 1, ?)`,
      [sid, hash, salt, thisMonth]
    );

    await logPinHistory(sid, "create", "student", req);

    res.status(201).json({
      success: true,
      message: "PIN created successfully ✅",
      changesRemaining: MAX_CHANGES_PER_MONTH - 1
    });
  } catch (err) {
    console.error("Create PIN error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ CHANGE PIN (requires old PIN, monthly limit applied)
// ============================================================
router.post("/pin/change", async (req, res) => {
  try {
    const { studentId, oldPin, newPin, confirmPin } = req.body;

    if (!studentId || !oldPin || !newPin || !confirmPin) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const sid = parseInt(studentId);

    if (newPin !== confirmPin) {
      return res.status(400).json({ success: false, message: "New PIN and Confirm PIN do not match" });
    }

    const pinErr = validatePin(newPin);
    if (pinErr) return res.status(400).json({ success: false, message: pinErr });

    if (oldPin === newPin) {
      return res.status(400).json({ success: false, message: "New PIN must be different from old PIN" });
    }

    const rows = await q(`SELECT * FROM student_pins WHERE student_id = ?`, [sid]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No PIN set. Please create one first." });
    }

    const pinRec = rows[0];

    // Lock check
    if (pinRec.locked_until && new Date(pinRec.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(pinRec.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked. Try again in ${mins} minute(s).`,
        lockedUntil: pinRec.locked_until
      });
    }

    // Old PIN verify
    const oldHash = hashPin(oldPin, pinRec.pin_salt);
    if (!safeCompareHex(oldHash, pinRec.pin_hash)) {
      const newFailed = (pinRec.failed_attempts || 0) + 1;
      let lockUntil = null;
      let msg = "Old PIN is incorrect";

      if (newFailed >= MAX_FAILED_ATTEMPTS) {
        lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        msg = "Too many failed attempts. Account locked for 30 minutes.";
      } else {
        msg = `Old PIN is incorrect. ${MAX_FAILED_ATTEMPTS - newFailed} attempts remaining.`;
      }

      await q(
        `UPDATE student_pins SET failed_attempts = ?, locked_until = ? WHERE student_id = ?`,
        [newFailed, lockUntil, sid]
      );

      return res.status(401).json({ success: false, message: msg, lockedUntil: lockUntil });
    }

    // Monthly limit check
    const thisMonth = currentMonthYear();
    let changesUsed = pinRec.change_count_this_month || 0;
    if (pinRec.month_year !== thisMonth) changesUsed = 0;

    if (changesUsed >= MAX_CHANGES_PER_MONTH) {
      return res.status(429).json({
        success: false,
        message: `You can change PIN max ${MAX_CHANGES_PER_MONTH} times per month. Limit reached for ${thisMonth}.`,
        changesUsed,
        changesRemaining: 0
      });
    }

    // Update PIN
    const newSalt = generatePinSalt();
    const newHash = hashPin(newPin, newSalt);

    await q(
      `UPDATE student_pins 
       SET pin_hash = ?, pin_salt = ?, last_changed_at = NOW(),
           change_count_this_month = ?, month_year = ?,
           failed_attempts = 0, locked_until = NULL
       WHERE student_id = ?`,
      [newHash, newSalt, changesUsed + 1, thisMonth, sid]
    );

    await logPinHistory(sid, "change", "student", req);

    const remaining = MAX_CHANGES_PER_MONTH - (changesUsed + 1);

    res.json({
      success: true,
      message: "PIN changed successfully ✅",
      changesRemaining: remaining,
      maxChangesPerMonth: MAX_CHANGES_PER_MONTH
    });
  } catch (err) {
    console.error("Change PIN error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ VERIFY PIN — Login flow me use hoga
// ============================================================
router.post("/pin/verify", async (req, res) => {
  try {
    const { studentId, pin } = req.body;
    if (!studentId || !pin) {
      return res.status(400).json({ success: false, message: "Student ID and PIN required" });
    }

    const sid = parseInt(studentId);
    const rows = await q(`SELECT * FROM student_pins WHERE student_id = ?`, [sid]);

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No PIN set for this student" });
    }

    const pinRec = rows[0];

    if (pinRec.locked_until && new Date(pinRec.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(pinRec.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked. Try again in ${mins} minute(s).`,
        lockedUntil: pinRec.locked_until
      });
    }

    const hash = hashPin(String(pin), pinRec.pin_salt);
    if (!safeCompareHex(hash, pinRec.pin_hash)) {
      const newFailed = (pinRec.failed_attempts || 0) + 1;
      let lockUntil = null;
      let msg = "Incorrect PIN";

      if (newFailed >= MAX_FAILED_ATTEMPTS) {
        lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        msg = "Too many failed attempts. Locked for 30 minutes.";
      } else {
        msg = `Incorrect PIN. ${MAX_FAILED_ATTEMPTS - newFailed} attempts left.`;
      }

      await q(
        `UPDATE student_pins SET failed_attempts = ?, locked_until = ? WHERE student_id = ?`,
        [newFailed, lockUntil, sid]
      );

      return res.status(401).json({ success: false, message: msg, lockedUntil: lockUntil });
    }

    await q(
      `UPDATE student_pins SET failed_attempts = 0, locked_until = NULL WHERE student_id = ?`,
      [sid]
    );

    const thisMonth = currentMonthYear();
    const needsChange = pinRec.month_year !== thisMonth;

    res.json({
      success: true,
      verified: true,
      message: "PIN verified ✅",
      needsChange,
      lastChangedAt: pinRec.last_changed_at
    });
  } catch (err) {
    console.error("Verify PIN error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ FORGOT PIN — Step 1: OTP bhejo registered email pe
// ============================================================
router.post("/pin/forgot/request-otp", async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: "Student ID required" });

    const sid = parseInt(studentId);
    const stu = await q(`SELECT id, name, email_id FROM Nstudent WHERE id = ?`, [sid]);
    if (!stu.length) return res.status(404).json({ success: false, message: "Student not found" });

    const student = stu[0];
    if (!student.email_id) {
      return res.status(400).json({ success: false, message: "No email registered. Contact admin." });
    }

    // Check if PIN exists
    const pinExists = await q(`SELECT id FROM student_pins WHERE student_id = ?`, [sid]);
    if (!pinExists.length) {
      return res.status(404).json({
        success: false,
        message: "No PIN set. Please create PIN first (dashboard se)."
      });
    }

    const otp = genPinOTP();
    const expiresAt = new Date(Date.now() + PIN_OTP_EXPIRY_MS);

    await q(`DELETE FROM student_pin_reset_otps WHERE student_id = ?`, [sid]);
    await q(
      `INSERT INTO student_pin_reset_otps (student_id, otp, expires_at) VALUES (?, ?, ?)`,
      [sid, otp, expiresAt]
    );

    // Mask email for response
    const [namePart, domain] = String(student.email_id).split("@");
    const maskedEmail = namePart.substring(0, 2) + "***@" + domain;

    // Send email via Brevo
    if (BREVO_API_KEY) {
      try {
        const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "api-key": BREVO_API_KEY
          },
          body: JSON.stringify({
            sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
            to: [{ email: student.email_id }],
            subject: "🔐 PIN Reset OTP — GSSS Shilla",
            htmlContent: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#f1f5f9; font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 18px rgba(0,0,0,0.08);">
<tr><td style="background: linear-gradient(135deg, #5b6bc0 0%, #7c4d9e 100%); padding: 32px 24px; text-align:center;">
<img src="${SCHOOL_LOGO_URL}" alt="GSSS" width="80" height="80" style="border-radius:50%; background:#fff; padding:6px; margin-bottom:12px;">
<h1 style="color:#fff; font-size:22px; margin:8px 0 2px;">GSSS SHILLA</h1>
<p style="color:#e0e7ff; font-size:13px; margin:0;">PIN Reset Verification</p>
</td></tr>
<tr><td style="padding: 32px 28px;">
<h2 style="color:#1e293b; font-size:18px; margin:0 0 8px;">Hello ${student.name},</h2>
<p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 20px;">
Someone requested to reset your 6-digit portal PIN. Use the OTP below to proceed.
</p>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%); border: 1.5px dashed #6366f1; border-radius: 12px; padding: 20px;">
<p style="margin:0 0 8px; color:#6366f1; font-size:12px; font-weight:600; text-transform:uppercase;">Your OTP Code</p>
<div style="font-size:36px; font-weight:800; letter-spacing:10px; color:#1e1b4b;">${otp}</div>
</td></tr>
</table>
<p style="color:#94a3b8; font-size:12px; margin:20px 0 0; line-height:1.6;">
⏱ Valid for <strong>10 minutes</strong>.<br>
If you didn't request this, please ignore this email — your PIN is safe.
</p>
</td></tr>
<tr><td style="background:#f8fafc; padding: 16px 24px; text-align:center; border-top:1px solid #e2e8f0;">
<p style="margin:0; color:#94a3b8; font-size:11px;">© ${new Date().getFullYear()} GSSS SHILLA · Automated email</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
            textContent: `Your PIN Reset OTP: ${otp}\nValid for 10 minutes.`
          })
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          console.error("Brevo PIN OTP error:", resp.status, errBody);
          // Don't fail — OTP saved in DB, admin can check logs
        }
      } catch (emailErr) {
        console.error("PIN OTP email error:", emailErr.message);
      }
    } else {
      console.log(`📧 PIN OTP for student ${sid}: ${otp}`);
    }

    res.json({
      success: true,
      message: `OTP sent to ${maskedEmail} ✅`,
      maskedEmail,
      expiresInMinutes: 10
    });
  } catch (err) {
    console.error("PIN forgot OTP error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ FORGOT PIN — Step 2: OTP verify + naya PIN set
// ============================================================
router.post("/pin/forgot/reset", async (req, res) => {
  try {
    const { studentId, otp, newPin, confirmPin } = req.body;

    if (!studentId || !otp || !newPin || !confirmPin) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const sid = parseInt(studentId);

    if (newPin !== confirmPin) {
      return res.status(400).json({ success: false, message: "New PIN and Confirm PIN do not match" });
    }

    const pinErr = validatePin(newPin);
    if (pinErr) return res.status(400).json({ success: false, message: pinErr });

    const rows = await q(
      `SELECT * FROM student_pin_reset_otps 
       WHERE student_id = ? AND expires_at > NOW() 
       ORDER BY id DESC LIMIT 1`,
      [sid]
    );

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "OTP expired or not found. Please request a new one." });
    }

    const rec = rows[0];

    if (rec.attempts >= PIN_OTP_MAX_ATTEMPTS) {
      await q(`DELETE FROM student_pin_reset_otps WHERE id = ?`, [rec.id]);
      return res.status(400).json({ success: false, message: "Too many wrong attempts. Request a new OTP." });
    }

    if (String(rec.otp) !== String(otp).trim()) {
      await q(`UPDATE student_pin_reset_otps SET attempts = attempts + 1 WHERE id = ?`, [rec.id]);
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. ${PIN_OTP_MAX_ATTEMPTS - rec.attempts - 1} attempts left.`
      });
    }

    await q(`UPDATE student_pin_reset_otps SET verified = 1 WHERE id = ?`, [rec.id]);

    // Reset PIN
    const pinRows = await q(`SELECT * FROM student_pins WHERE student_id = ?`, [sid]);
    const thisMonth = currentMonthYear();
    const salt = generatePinSalt();
    const hash = hashPin(newPin, salt);

    if (!pinRows.length) {
      await q(
        `INSERT INTO student_pins 
         (student_id, pin_hash, pin_salt, last_changed_at, change_count_this_month, month_year)
         VALUES (?, ?, ?, NOW(), 1, ?)`,
        [sid, hash, salt, thisMonth]
      );
    } else {
      const pinRec = pinRows[0];
      let changesUsed = pinRec.change_count_this_month || 0;
      if (pinRec.month_year !== thisMonth) changesUsed = 0;

      if (changesUsed >= MAX_CHANGES_PER_MONTH) {
        return res.status(429).json({
          success: false,
          message: `Monthly limit reached (${MAX_CHANGES_PER_MONTH}/month). Contact admin to reset.`,
          code: "MONTHLY_LIMIT_REACHED"
        });
      }

      await q(
        `UPDATE student_pins 
         SET pin_hash = ?, pin_salt = ?, last_changed_at = NOW(),
             change_count_this_month = ?, month_year = ?,
             failed_attempts = 0, locked_until = NULL
         WHERE student_id = ?`,
        [hash, salt, changesUsed + 1, thisMonth, sid]
      );
    }

    await q(`DELETE FROM student_pin_reset_otps WHERE student_id = ?`, [sid]);
    await logPinHistory(sid, "reset_by_student", "student", req);

    res.json({ success: true, message: "PIN reset successfully ✅ Please login with your new PIN." });
  } catch (err) {
    console.error("PIN reset error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ ADMIN — Reset kisi bhi student ka PIN (monthly counter refresh)
// ============================================================
router.post("/pin/admin/reset", async (req, res) => {
  try {
    const { studentId, newPin, adminKey } = req.body;

    const ADMIN_KEY = process.env.ADMIN_PIN_KEY || "GSSS_ADMIN_2026";
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (!studentId || !newPin) {
      return res.status(400).json({ success: false, message: "studentId and newPin required" });
    }

    const pinErr = validatePin(newPin);
    if (pinErr) return res.status(400).json({ success: false, message: pinErr });

    const sid = parseInt(studentId);
    const stu = await q(`SELECT id, name FROM Nstudent WHERE id = ?`, [sid]);
    if (!stu.length) return res.status(404).json({ success: false, message: "Student not found" });

    const salt = generatePinSalt();
    const hash = hashPin(newPin, salt);
    const thisMonth = currentMonthYear();

    const existing = await q(`SELECT id FROM student_pins WHERE student_id = ?`, [sid]);
    if (existing.length) {
      await q(
        `UPDATE student_pins 
         SET pin_hash = ?, pin_salt = ?, last_changed_at = NOW(),
             change_count_this_month = 0, month_year = ?,
             failed_attempts = 0, locked_until = NULL
         WHERE student_id = ?`,
        [hash, salt, thisMonth, sid]
      );
    } else {
      await q(
        `INSERT INTO student_pins 
         (student_id, pin_hash, pin_salt, last_changed_at, change_count_this_month, month_year)
         VALUES (?, ?, ?, NOW(), 0, ?)`,
        [sid, hash, salt, thisMonth]
      );
    }

    await logPinHistory(sid, "reset_by_admin", "admin", req);

    res.json({
      success: true,
      message: `PIN reset by admin ✅ (month counter refreshed to 0)`
    });
  } catch (err) {
    console.error("Admin PIN reset error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ ADMIN — Unlock a locked student
// ============================================================
router.post("/pin/admin/unlock", async (req, res) => {
  try {
    const { studentId, adminKey } = req.body;
    const ADMIN_KEY = process.env.ADMIN_PIN_KEY || "GSSS_ADMIN_2026";
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const sid = parseInt(studentId);
    await q(
      `UPDATE student_pins SET failed_attempts = 0, locked_until = NULL WHERE student_id = ?`,
      [sid]
    );

    await logPinHistory(sid, "admin_unlock", "admin", req);
    res.json({ success: true, message: "Account unlocked ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ ADMIN — PIN change history of a student
// ============================================================
router.get("/pin/admin/history/:studentId", async (req, res) => {
  try {
    const { adminKey } = req.query;
    const ADMIN_KEY = process.env.ADMIN_PIN_KEY || "GSSS_ADMIN_2026";
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const sid = parseInt(req.params.studentId);
    const rows = await q(
      `SELECT id, action, changed_by, ip_address, user_agent, created_at 
       FROM student_pin_history WHERE student_id = ? 
       ORDER BY created_at DESC LIMIT 100`,
      [sid]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ ADMIN — All students ka PIN status (with monthly change alerts)
// ============================================================
router.get("/pin/admin/all-status", async (req, res) => {
  try {
    const { adminKey, filter } = req.query;
    const ADMIN_KEY = process.env.ADMIN_PIN_KEY || "GSSS_ADMIN_2026";
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const thisMonth = currentMonthYear();

    let whereClause = "";
    if (filter === "no_pin") whereClause = "WHERE p.id IS NULL";
    else if (filter === "locked") whereClause = "WHERE p.locked_until IS NOT NULL AND p.locked_until > NOW()";
    else if (filter === "needs_change") whereClause = "WHERE p.id IS NOT NULL AND p.month_year != ?";
    else if (filter === "limit_reached") whereClause = "WHERE p.change_count_this_month >= ?";

    const params = [];
    if (filter === "needs_change") params.push(thisMonth);
    if (filter === "limit_reached") params.push(MAX_CHANGES_PER_MONTH);

    const rows = await q(
      `SELECT n.id, n.student_id, n.name, n.class, n.email_id, n.mobile_number,
              p.last_changed_at, p.change_count_this_month, p.month_year,
              p.locked_until, p.failed_attempts,
              CASE 
                WHEN p.id IS NULL THEN 'no_pin'
                WHEN p.locked_until IS NOT NULL AND p.locked_until > NOW() THEN 'locked'
                WHEN p.month_year != ? THEN 'needs_change'
                WHEN p.change_count_this_month >= ? THEN 'limit_reached'
                ELSE 'ok'
              END AS pin_status
       FROM Nstudent n
       LEFT JOIN student_pins p ON p.student_id = n.id
       ${whereClause}
       ORDER BY n.class, n.name
       LIMIT 500`,
      filter === "needs_change" || filter === "limit_reached"
        ? params
        : [thisMonth, MAX_CHANGES_PER_MONTH]
    );

    res.json({
      success: true,
      monthYear: thisMonth,
      maxChangesPerMonth: MAX_CHANGES_PER_MONTH,
      count: rows.length,
      data: rows
    });
  } catch (err) {
    console.error("Admin all-status error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ ADMIN — Dashboard summary (counts)
// ============================================================
router.get("/pin/admin/summary", async (req, res) => {
  try {
    const { adminKey } = req.query;
    const ADMIN_KEY = process.env.ADMIN_PIN_KEY || "GSSS_ADMIN_2026";
    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const thisMonth = currentMonthYear();

    const totalStudents = (await q(`SELECT COUNT(*) AS c FROM Nstudent`))[0].c;
    const totalPins    = (await q(`SELECT COUNT(*) AS c FROM student_pins`))[0].c;
    const locked       = (await q(`SELECT COUNT(*) AS c FROM student_pins WHERE locked_until IS NOT NULL AND locked_until > NOW()`))[0].c;
    const needsChange  = (await q(`SELECT COUNT(*) AS c FROM student_pins WHERE month_year != ?`, [thisMonth]))[0].c;
    const limitReached = (await q(`SELECT COUNT(*) AS c FROM student_pins WHERE change_count_this_month >= ? AND month_year = ?`, [MAX_CHANGES_PER_MONTH, thisMonth]))[0].c;

    res.json({
      success: true,
      monthYear: thisMonth,
      stats: {
        totalStudents,
        totalPins,
        noPin: totalStudents - totalPins,
        locked,
        needsChange,
        limitReached
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ✅ END PIN SYSTEM
// ============================================================

module.exports = router;



