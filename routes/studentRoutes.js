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

const REQUIRED_DOCS = [
  "studentPhoto", "signature", "aadharCard", "himachaliBonafide",
  "casteCertificate", "apaarCard", "previousMarksheet"
];

const CLASS_ORDER = ["Nursery", "LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

// ==================== HELPERS ====================
const toSnake = (s) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

const BODY_FIELDS = [
  "studentId", "admissionNumber", "admissionDate", "name", "fatherName",
  "motherName", "dob", "aadharNumber", "apaarId", "class", "rollNumber",
  "session", "mobileNumber", "emailId", "gender", "category", "address",
  "status", "promotedFrom", "promotionDate", "stream", "village", "postOffice", "tehsil", "district", "state", "pincode"
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

// ==================== VALIDATION ====================
const rules = () => [
  body("studentId").trim().notEmpty().withMessage("Student ID required"),
  body("admissionNumber").trim().notEmpty().withMessage("Admission Number required"),
  body("admissionDate").isISO8601().withMessage("Valid admission date required"),
  body("name").trim().notEmpty().withMessage("Name required"),
  body("fatherName").trim().notEmpty().withMessage("Father name required"),
  body("motherName").trim().notEmpty().withMessage("Mother name required"),
  body("dob").isISO8601().withMessage("Valid DOB required"),
  body("aadharNumber").matches(/^\d{12}$/).withMessage("Aadhar must be 12 digits"),
  body("class").notEmpty().withMessage("Class required"),
  body("rollNumber").notEmpty().withMessage("Roll number required"),
  body("session").matches(/^\d{4}-\d{2,4}$/).withMessage("Session format YYYY-YY or YYYY-YYYY"),
  body("mobileNumber").matches(/^[6-9]\d{9}$/).withMessage("Invalid mobile number"),
  body("emailId").isEmail().withMessage("Invalid email"),
  body("gender").isIn(["Male", "Female", "Other"]).withMessage("Gender required"),
  body("category").isIn(["General", "SC", "ST", "OBC", "EWS", "Other"]).withMessage("Category required"),
  body("address").trim().notEmpty().withMessage("Address required")
];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

const destroyAsset = async (publicId, url) => {
  if (!publicId) return;
  const resourceType = (url || "").includes("/raw/") ? "raw" : "image";
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (e) {
    console.error("Cloudinary delete error:", e.message);
  }
};

// ============================================================
// ENSURE SETTINGS TABLE
// ============================================================
(async () => {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        \`value\` VARCHAR(500) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ settings table ready");
  } catch (err) {
    console.error("❌ settings table create error:", err.message);
  }
})();

// ============================================================
// GET ALL STUDENTS
// ============================================================
router.get("/", async (req, res) => {
  try {
    const {
      class: cls, session, gender, category, status,
      search, sortBy = "created_at", order = "desc",
      page = 1, limit = 20
    } = req.query;

    const allowedSort = ["created_at", "name", "class", "roll_number", "admission_date", "admission_number"];
    const sortCol = allowedSort.includes(sortBy) ? sortBy : "created_at";
    const sortDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    const where = [];
    const params = [];

    if (cls)      { where.push("class = ?");    params.push(cls); }
    if (session)  { where.push("session = ?");  params.push(session); }
    if (gender)   { where.push("gender = ?");   params.push(gender); }
    if (category) { where.push("category = ?"); params.push(category); }
    if (status)   { where.push("status = ?");   params.push(status); }

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

    res.json({
      success: true,
      data: rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("❌ Fetch Students Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// SESSION SETTINGS — Get current
// ============================================================
router.get("/current-session", async (req, res) => {
  try {
    const rows = await q("SELECT `value` FROM settings WHERE `key` = 'current_session'");
    res.json({ success: true, session: rows[0]?.value || null });
  } catch (err) {
    console.error("❌ Get current session error:", err);
    res.json({ success: true, session: null });
  }
});

// ============================================================
// SESSION SETTINGS — Set current
// ============================================================
router.post("/current-session", async (req, res) => {
  try {
    const { session } = req.body;
    if (!session || !/^\d{4}-\d{2,4}$/.test(session)) {
      return res.status(400).json({
        success: false,
        message: "Invalid session format (YYYY-YY or YYYY-YYYY)"
      });
    }
    await q(
      "INSERT INTO settings (`key`, `value`) VALUES ('current_session', ?) ON DUPLICATE KEY UPDATE `value` = ?",
      [session, session]
    );
    res.json({ success: true, message: "Current session saved ✅", session });
  } catch (err) {
    console.error("❌ Save current session error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GROUP BY CLASS
// ============================================================
router.get("/by-class", async (req, res) => {
  try {
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
  } catch (err) {
    console.error("❌ Group By Class Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PROMOTE — Bulk selected students
// ============================================================
router.post("/promote", async (req, res) => {
  try {
    const { studentIds, toClass } = req.body;
    if (!Array.isArray(studentIds) || !studentIds.length || !toClass) {
      return res.status(400).json({
        success: false,
        message: "studentIds[] and toClass are required"
      });
    }

    const updatedCount = await db.transaction(async (conn) => {
      const ph = studentIds.map(() => "?").join(",");
      const [rows] = await conn.query(
        `SELECT id, class, session FROM Nstudent WHERE id IN (${ph})`,
        studentIds
      );

      for (const s of rows) {
        await conn.query(
          `UPDATE Nstudent
           SET promoted_from = ?, class = ?, session = ?, status = 'Promoted', promotion_date = NOW()
           WHERE id = ?`,
          [s.class, toClass, incrementSession(s.session), s.id]
        );
      }
      return rows.length;
    });

    res.json({
      success: true,
      message: `${updatedCount} students promoted successfully ✅`
    });
  } catch (err) {
    console.error("❌ Promote Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PROMOTE WHOLE SESSION
// ============================================================
router.post("/promote-session", async (req, res) => {
  try {
    const { fromSession, toSession } = req.body;
    if (!fromSession || !toSession) {
      return res.status(400).json({
        success: false,
        message: "fromSession and toSession are required"
      });
    }

    const result = await db.transaction(async (conn) => {
      const [rows] = await conn.query(
        `SELECT id, class FROM Nstudent WHERE session = ? AND status = 'Active'`,
        [fromSession]
      );

      let promoted = 0;
      let skipped = 0;

      for (const s of rows) {
        const nxt = nextClass(s.class);
        if (!nxt) { skipped++; continue; }
        await conn.query(
          `UPDATE Nstudent
           SET promoted_from = ?, class = ?, session = ?, status = 'Promoted', promotion_date = NOW()
           WHERE id = ?`,
          [s.class, nxt, toSession, s.id]
        );
        promoted++;
      }

      await conn.query(
        "INSERT INTO settings (`key`, `value`) VALUES ('current_session', ?) ON DUPLICATE KEY UPDATE `value` = ?",
        [toSession, toSession]
      );

      return { promoted, skipped, total: rows.length };
    });

    res.json({
      success: true,
      message: `${result.promoted} students promoted from ${fromSession} → ${toSession}. ${result.skipped ? `${result.skipped} skipped (already final class).` : ""} ✅`,
      count: result.promoted,
      skipped: result.skipped,
      newSession: toSession
    });
  } catch (err) {
    console.error("❌ Promote Session Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// SEARCH
// ============================================================
router.get("/search/:query", async (req, res) => {
  try {
    const searchQuery = req.params.query;
    const { limit = 20 } = req.query;

    const rows = await q(
      `SELECT * FROM Nstudent
       WHERE name LIKE ? OR admission_number LIKE ? OR student_id LIKE ? OR father_name LIKE ?
       ORDER BY id DESC LIMIT ?`,
      [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, parseInt(limit)]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("❌ Search Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADD STUDENT
// ============================================================
router.post("/add", studentUploadFields, rules(), validate, async (req, res) => {
  try {
    // Backend enforcement: required docs
    const missing = [];
    for (const docName of REQUIRED_DOCS) {
      if (!req.files || !req.files[docName] || !req.files[docName][0]) {
        missing.push(docName.replace(/([A-Z])/g, " $1").trim());
      }
    }
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required documents: ${missing.join(", ")}`
      });
    }

    const data = { ...pickBody(req.body), ...extractFiles(req.files) };
    if (!data.status) data.status = "Active";
    if (!data.promoted_from) data.promoted_from = null;

    const cols = Object.keys(data);
    const vals = Object.values(data);
    const ph = cols.map(() => "?").join(",");

    const result = await q(
      `INSERT INTO Nstudent (${cols.join(",")}) VALUES (${ph})`,
      vals
    );

    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [result.insertId]);
    res.status(201).json({
      success: true,
      message: "Student added successfully ✅",
      data: rows[0],
      student: rows[0]
    });
  } catch (err) {
    console.error("❌ Add Student Error:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "Student ID or Admission Number already exists"
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GET SINGLE STUDENT
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid student ID" });
    }

    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    res.json({ success: true, data: rows[0], student: rows[0] });
  } catch (err) {
    console.error("❌ Fetch Student Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// UPDATE STUDENT
// ============================================================
router.put("/:id", studentUploadFields, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid student ID" });
    }

    const existingRows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!existingRows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    const existing = existingRows[0];

    const newFiles = extractFiles(req.files);

    for (const f of DOC_FIELDS) {
      const snake = toSnake(f);
      const newPid = newFiles[`${snake}_pid`];
      const oldPid = existing[`${snake}_pid`];
      if (newPid && oldPid) {
        await destroyAsset(oldPid, existing[`${snake}_url`]);
      }
    }

    const data = { ...pickBody(req.body), ...newFiles };
    const cols = Object.keys(data);

    if (!cols.length) {
      return res.json({ success: true, message: "No changes", data: existing, student: existing });
    }

    const setSql = cols.map((c) => `${c} = ?`).join(", ");
    await q(`UPDATE Nstudent SET ${setSql} WHERE id = ?`, [...Object.values(data), id]);

    const updatedRows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    res.json({
      success: true,
      message: "Student updated successfully ✅",
      data: updatedRows[0],
      student: updatedRows[0]
    });
  } catch (err) {
    console.error("❌ Update Student Error:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "Student ID or Admission Number already exists"
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// DELETE STUDENT
// ============================================================
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid student ID" });
    }

    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    const s = rows[0];

    for (const f of DOC_FIELDS) {
      const snake = toSnake(f);
      if (s[`${snake}_pid`]) {
        await destroyAsset(s[`${snake}_pid`], s[`${snake}_url`]);
      }
    }

    await q("DELETE FROM Nstudent WHERE id = ?", [id]);
    res.json({ success: true, message: "Student deleted successfully ✅" });
  } catch (err) {
    console.error("❌ Delete Student Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// SERVER-SIDE PROFESSIONAL PDF — /:id/pdf
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

router.get("/:id/pdf", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid student ID" });
    }

    const rows = await q("SELECT * FROM Nstudent WHERE id = ?", [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    const s = rows[0];

    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${s.admission_number || "student"}.pdf"`
    );

    doc.pipe(res);

    // HEADER
    doc.rect(0, 0, doc.page.width, 80).fill("#1e3a8a");
    doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold")
      .text("STUDENT ADMISSION RECORD", 40, 25, { align: "center" });
    doc.fontSize(10).font("Helvetica")
      .text("Official Document", 40, 55, { align: "center" });
    doc.fillColor("#000000");

    // PHOTO
    const photoBuf = await fetchImageBuffer(s.student_photo_url);
    const px = doc.page.width - 150;
    const py = 110;

    if (photoBuf) {
      try { doc.image(photoBuf, px, py, { width: 100, height: 120 }); }
      catch (e) { /* skip */ }
    } else {
      doc.rect(px, py, 100, 120).stroke();
      doc.fontSize(9).fillColor("#666").text("No Photo", px + 25, py + 55);
    }

    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a8a")
      .text("Personal Details", 40, 110);
    doc.moveTo(40, 130).lineTo(400, 130).stroke("#1e3a8a");

    doc.y = 145;
    const row = (label, value) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e3a8a")
        .text(`${label}: `, { continued: true });
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

    // DOCUMENTS PAGE
    doc.addPage();
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#1e3a8a")
      .text("Uploaded Documents", { align: "center" });
    doc.moveDown(1);

    const docs = [
      ["Aadhar Card", s.aadhar_card_url],
      ["Himachali Bonafide", s.himachali_bonafide_url],
      ["Caste Certificate", s.caste_certificate_url],
      ["APAAR Card", s.apaar_card_url],
      ["Previous Marksheet", s.previous_marksheet_url],
      ["Income Certificate", s.income_certificate_url],
      ["BPL Certificate", s.bpl_certificate_url],
      ["Signature", s.signature_url],
      ["Other Document", s.other_document_url]
    ];

    let y = doc.y;
    for (const [label, url] of docs) {
      if (!url) continue;
      if (y > 720) { doc.addPage(); y = 50; }
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#1e3a8a").text(`${label}:`, 40, y);
      doc.font("Helvetica").fontSize(9).fillColor("#2563eb")
        .text(url, 40, y + 14, { link: url, underline: true, width: 500 });
      y += 42;
    }

    doc.fontSize(8).fillColor("#666")
      .text(
        `Generated on ${new Date().toLocaleString("en-IN")}`,
        40,
        doc.page.height - 40,
        { align: "center" }
      );

    doc.end();
  } catch (err) {
    console.error("❌ PDF Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

// ============================================================
// STUDENT LOGIN VERIFY
// ============================================================
router.post("/verify-login", async (req, res) => {
  try {
    const { class: cls, studentId, apaarId, dob } = req.body;

    if (!cls || !studentId || !apaarId || !dob) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    if (!/^\d{11}$/.test(apaarId)) {
      return res.status(400).json({
        success: false,
        message: "APAAR ID must be 11 digits"
      });
    }

    // Lookup student
    const rows = await q(
      `SELECT * FROM Nstudent
       WHERE class = ?
         AND student_id = ?
         AND apaar_id = ?
         AND DATE(dob) = DATE(?)
       LIMIT 1`,
      [cls, studentId, apaarId, dob]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials. Please check your details."
      });
    }

    const s = rows[0];

    // Simple token (timestamp-based, not JWT — enough for portal)
    const token = Buffer.from(`${s.id}-${Date.now()}`).toString("base64");

    // Return student data (hide pids for safety)
    const safeStudent = { ...s };
    delete safeStudent.__v;
    // We keep _pid fields for nothing — remove them for security
    for (const k of Object.keys(safeStudent)) {
      if (k.endsWith("_pid")) delete safeStudent[k];
    }

    res.json({
      success: true,
      message: "Login successful ✅",
      student: safeStudent,
      token
    });
  } catch (err) {
    console.error("❌ Verify login error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;
