// routes/attendance.js
// ═══════════════════════════════════════════════════════════════
// COMPLETE ATTENDANCE SYSTEM — Single File
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");

const q = (sql, params = []) => db.query(sql, params);

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || "gsss-shilla-jwt-secret-2026";
const QR_SECRET = process.env.QR_SECRET || "gsss-shilla-qr-secret-2026";
const ABSENT_AUTO_DELETE_DAYS = 5;
const VERIFY_PREFIX = "https://gsssshilla07.pages.dev/verify/";

const SCHOOL = {
  name: "GOVT. SR. SEC. SCHOOL SHILLA",
  address: "Shilla, Teh. Nerwa, Distt. Shimla, Himachal Pradesh - 171210",
  logoUrl: "https://gsssshilla07.pages.dev/logo(1).png",
  principalSignatureUrl: "https://gsssshilla07.pages.dev/principal.png",
  helpline: "+91 9805444375"
};

// ═══════════════════════════════════════════════════════════════
// QR TOKEN FUNCTIONS
// ═══════════════════════════════════════════════════════════════
function generateQRToken(studentCode) {
  return `${VERIFY_PREFIX}${encodeURIComponent(studentCode)}`;
}

function verifyQRToken(token) {
  if (!token || typeof token !== "string") return null;
  const clean = token.trim();

  if (clean.includes("/verify/")) {
    try {
      const url = new URL(clean);
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("verify");
      if (idx !== -1 && parts[idx + 1]) {
        return { studentCode: decodeURIComponent(parts[idx + 1]) };
      }
    } catch (e) {}
    const m = clean.match(/\/verify\/([^\/\?#]+)/);
    if (m && m[1]) return { studentCode: decodeURIComponent(m[1]) };
    return null;
  }

  if (/^[A-Z0-9_\-]+$/i.test(clean) && clean.length >= 2 && clean.length <= 50) {
    return { studentCode: clean };
  }

  if (clean.startsWith("GSSS:")) {
    const parts = clean.split(":");
    if (parts.length !== 4) return null;
    const [, studentCode, random, hmac] = parts;
    if (!studentCode || !random || !hmac) return null;
    const expected = crypto
      .createHmac("sha256", QR_SECRET)
      .update(`${studentCode}:${random}`)
      .digest("hex")
      .slice(0, 16);
    if (hmac.length !== expected.length) return null;
    let match = true;
    for (let i = 0; i < hmac.length; i++) {
      if (hmac[i] !== expected[i]) match = false;
    }
    if (!match) return null;
    return { studentCode };
  }

  return null;
}

async function generateQRImage(token) {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: "H",
    width: 300,
    margin: 1,
    color: { dark: "#1a2332", light: "#ffffff" }
  });
}

// ═══════════════════════════════════════════════════════════════
// TIME HELPERS — IST (Asia/Kolkata)
// ═══════════════════════════════════════════════════════════════
function getISTDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function todayDay() {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[getISTDate().getDay()];
}

function todayDateStr() {
  const d = getISTDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowTimeStr() {
  const d = getISTDate();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function nowHM() {
  const d = getISTDate();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function hmToMin(hm) {
  if (!hm) return 0;
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

function isWithinWindow(startTime, endTime) {
  const cur = hmToMin(nowHM());
  const s = hmToMin(startTime);
  const e = hmToMin(endTime);
  return cur >= s && cur <= e;
}

function isLateArrival(lateAfter) {
  if (!lateAfter) return false;
  return hmToMin(nowHM()) > hmToMin(lateAfter);
}

function monthName(num) {
  return ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"][num - 1] || "";
}

// ═══════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
function authAdmin(req, res, next) {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    const decoded = jwt.verify(h.replace("Bearer ", ""), JWT_SECRET);
    const adminRoles = ["admin", "super admin", "superadmin", "super_admin", "super-admin"];
    const userRole = String(decoded.role || "").toLowerCase().trim();
    if (!adminRoles.includes(userRole)) {
      return res.status(403).json({ success: false, message: `Admin only. Your role: ${decoded.role}` });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function authTeacher(req, res, next) {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    const decoded = jwt.verify(h.replace("Bearer ", ""), JWT_SECRET);
    if (decoded.role !== "teacher") {
      return res.status(403).json({ success: false, message: `Teacher only. Your role: ${decoded.role}` });
    }
    req.teacher = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DELETE ABSENT
// ═══════════════════════════════════════════════════════════════
async function autoDeleteAbsentStudents() {
  try {
    const flagged = await q(
      `SELECT sat.student_id, sat.consecutive_absent_days, n.name, n.student_id AS code
       FROM student_absence_tracker sat
       JOIN Nstudent n ON n.id = sat.student_id
       WHERE sat.consecutive_absent_days >= ?
         AND sat.auto_deleted = 0
         AND n.status = 'Active'`,
      [ABSENT_AUTO_DELETE_DAYS]
    );

    let count = 0;
    for (const s of flagged) {
      try {
        await q(`UPDATE Nstudent SET status = 'Auto-Deleted', promotion_date = NOW() WHERE id = ?`, [s.student_id]);
        await q(
          `UPDATE student_absence_tracker 
           SET auto_deleted = 1, deleted_at = NOW(), is_flagged = 1, flagged_at = NOW()
           WHERE student_id = ?`,
          [s.student_id]
        );
        console.log(`🗑️ Auto-deleted: ${s.name} (${s.code})`);
        count++;
      } catch (e) {}
    }
    return count;
  } catch (err) {
    console.error("Auto-delete error:", err.message);
    return 0;
  }
}

setInterval(autoDeleteAbsentStudents, 6 * 60 * 60 * 1000);
setTimeout(autoDeleteAbsentStudents, 30000);

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function formatStudent(s) {
  return {
    id: s.id,
    student_id: s.student_id,
    name: s.name,
    father_name: s.father_name,
    mother_name: s.mother_name,
    dob: s.dob,
    class: s.class,
    stream: s.stream,
    section: s.section,
    roll_number: s.roll_number,
    email_id: s.email_id,
    mobile_number: s.mobile_number,
    photo_url: s.student_photo_url
  };
}

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
      const chunks = [];
      resp.on("data", c => chunks.push(c));
      resp.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// ═══════════════════════════════════════════════════════════════
// TEACHER AUTH
// ═══════════════════════════════════════════════════════════════
router.post("/teacher/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email & password required" });
    }

    const rows = await q(
      "SELECT * FROM teachers WHERE email = ? AND is_active = 1 LIMIT 1",
      [email.toLowerCase().trim()]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const teacher = rows[0];
    const ok = await bcrypt.compare(password, teacher.password);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign(
      { id: teacher.id, role: "teacher", name: teacher.name, email: teacher.email },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    const day = todayDay();
    const assignments = await q(
      `SELECT a.*, s.name AS subject_name, s.code AS subject_code
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       WHERE a.teacher_id = ? AND a.is_active = 1
         AND (a.days LIKE ? OR a.days = '')
       ORDER BY a.period ASC`,
      [teacher.id, `%${day}%`]
    );

    res.json({
      success: true,
      message: "Login successful ✅",
      token,
      teacher: {
        id: teacher.id,
        teacher_id: teacher.teacher_id,
        name: teacher.name,
        email: teacher.email,
        photo_url: teacher.photo_url
      },
      todayAssignments: assignments
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEACHER — MY PERIODS
// ═══════════════════════════════════════════════════════════════
router.get("/teacher/my-periods", authTeacher, async (req, res) => {
  try {
    const day = todayDay();
    const dateStr = todayDateStr();

    const assignments = await q(
      `SELECT a.*, s.name AS subject_name, s.code AS subject_code
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       WHERE a.teacher_id = ? AND a.is_active = 1
         AND (a.days LIKE ? OR a.days = '')
       ORDER BY a.period ASC`,
      [req.teacher.id, `%${day}%`]
    );

    const enriched = await Promise.all(
      assignments.map(async (a) => {
        const marked = await q(
          `SELECT COUNT(*) AS cnt FROM attendance
           WHERE teacher_id = ? AND class = ? AND period = ? AND date_str = ?`,
          [req.teacher.id, a.class, a.period, dateStr]
        );
        const total = await q(
          `SELECT COUNT(*) AS cnt FROM teacher_students
           WHERE teacher_id = ? AND assignment_id = ?`,
          [req.teacher.id, a.id]
        );
        const inWindow = isWithinWindow(a.start_time, a.end_time);
        return {
          ...a,
          markedCount: marked[0]?.cnt || 0,
          totalStudents: total[0]?.cnt || 0,
          isLive: inWindow,
          canScan: inWindow
        };
      })
    );

    res.json({
      success: true,
      day,
      date: dateStr,
      currentTime: nowTimeStr(),
      data: enriched
    });
  } catch (err) {
    console.error("My-periods error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEACHER — MY CLASSES
// ═══════════════════════════════════════════════════════════════
router.get("/teacher/my-classes", authTeacher, async (req, res) => {
  try {
    const classes = await q(
      `SELECT DISTINCT a.class, a.section,
        (SELECT COUNT(*) FROM Nstudent n WHERE n.class = a.class AND n.status = 'Active') AS student_count
       FROM assignments a
       WHERE a.teacher_id = ? AND a.is_active = 1
       ORDER BY a.class ASC`,
      [req.teacher.id]
    );
    res.json({ success: true, data: classes, count: classes.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEACHER — STUDENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get("/teacher/search-student/:studentCode", authTeacher, async (req, res) => {
  try {
    const { studentCode } = req.params;
    const code = String(studentCode).trim();

    if (!code) return res.status(400).json({ success: false, message: "Student ID required" });

    const rows = await q(
      `SELECT 
          id, student_id, name, father_name, mother_name, dob,
          class, stream, roll_number, email_id, mobile_number,
          section, student_photo_url, status,
          admission_number, aadhar_number, apaar_id,
          gender, category, address,
          village, post_office, tehsil, district, state, pincode
       FROM Nstudent WHERE student_id = ? LIMIT 1`,
      [code]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: `❌ Student ID "${code}" not found`,
        code: "NOT_FOUND"
      });
    }

    const student = rows[0];
    if (student.status !== "Active") {
      return res.status(400).json({
        success: false,
        message: `❌ Student is not active (Status: ${student.status})`,
        code: "INACTIVE"
      });
    }

    res.json({
      success: true,
      data: {
        id: student.id,
        student_id: student.student_id,
        name: student.name,
        father_name: student.father_name,
        mother_name: student.mother_name,
        dob: student.dob,
        class: student.class,
        stream: student.stream,
        roll_number: student.roll_number,
        email_id: student.email_id,
        mobile_number: student.mobile_number,
        section: student.section,
        photo_url: student.student_photo_url,
        status: student.status,
        admission_number: student.admission_number,
        aadhar_number: student.aadhar_number,
        apaar_id: student.apaar_id,
        gender: student.gender,
        category: student.category,
        address: student.address,
        village: student.village,
        post_office: student.post_office,
        tehsil: student.tehsil,
        district: student.district,
        state: student.state,
        pincode: student.pincode
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/teacher/add-student", authTeacher, async (req, res) => {
  try {
    const { studentCode, assignmentId } = req.body;
    if (!studentCode || !assignmentId) {
      return res.status(400).json({ success: false, message: "studentCode and assignmentId required" });
    }

    const code = String(studentCode).trim();

    const assignRows = await q(
      `SELECT * FROM assignments WHERE id = ? AND teacher_id = ? AND is_active = 1 LIMIT 1`,
      [assignmentId, req.teacher.id]
    );
    if (!assignRows.length) {
      return res.status(404).json({ success: false, message: "Assignment not found or not yours" });
    }
    const assignment = assignRows[0];

    const studentRows = await q(
      `SELECT id, student_id, name, father_name, mother_name, dob,
              class, stream, section, roll_number, email_id, mobile_number,
              student_photo_url, status
       FROM Nstudent WHERE student_id = ? LIMIT 1`,
      [code]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: `❌ Student "${code}" not found` });
    }
    const student = studentRows[0];

    if (student.status !== "Active") {
      return res.status(400).json({ success: false, message: "Student is not active" });
    }

    if (String(student.class) !== String(assignment.class)) {
      return res.status(400).json({
        success: false,
        message: `Student is from Class ${student.class}, but this assignment is for Class ${assignment.class}`
      });
    }

    const existing = await q(
      `SELECT id FROM teacher_students 
       WHERE teacher_id = ? AND assignment_id = ? AND student_id = ? LIMIT 1`,
      [req.teacher.id, assignmentId, student.id]
    );
    if (existing.length) {
      return res.status(400).json({ success: false, message: `⚠️ ${student.name} is already in this period's list` });
    }

    await q(
      `INSERT INTO teacher_students (teacher_id, assignment_id, student_id, student_code, class)
       VALUES (?, ?, ?, ?, ?)`,
      [req.teacher.id, assignmentId, student.id, student.student_id, student.class]
    );

    res.status(201).json({
      success: true,
      message: `✅ ${student.name} added to Period ${assignment.period}`,
      data: student
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ success: false, message: "Already added" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/teacher/assignment/:assignmentId/students", authTeacher, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignRows = await q(
      `SELECT a.*, s.name AS subject_name, s.code AS subject_code
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       WHERE a.id = ? AND a.teacher_id = ? AND a.is_active = 1 LIMIT 1`,
      [assignmentId, req.teacher.id]
    );
    if (!assignRows.length) {
      return res.status(404).json({ success: false, message: "Assignment not found" });
    }
    const assignment = assignRows[0];

    const students = await q(
      `SELECT ts.id AS ts_id, ts.added_at,
              n.id, n.student_id, n.name, n.father_name, n.mother_name, n.dob,
              n.class, n.stream, n.section, n.roll_number, n.email_id, n.mobile_number,
              n.student_photo_url
       FROM teacher_students ts
       JOIN Nstudent n ON n.id = ts.student_id
       WHERE ts.teacher_id = ? AND ts.assignment_id = ? AND n.status = 'Active'
       ORDER BY CAST(n.roll_number AS UNSIGNED), n.name ASC`,
      [req.teacher.id, assignmentId]
    );

    const dateStr = todayDateStr();
    const studentIds = students.map(s => s.id);
    let todayAtt = [];
    if (studentIds.length) {
      const ph = studentIds.map(() => "?").join(",");
      todayAtt = await q(
        `SELECT student_id, status, marked_time FROM attendance
         WHERE date_str = ? AND period = ? AND student_id IN (${ph})`,
        [dateStr, assignment.period, ...studentIds]
      );
    }
    const attMap = {};
    todayAtt.forEach(a => { attMap[a.student_id] = a; });

    const enriched = students.map(s => ({
      id: s.id,
      student_id: s.student_id,
      name: s.name,
      father_name: s.father_name,
      mother_name: s.mother_name,
      dob: s.dob,
      class: s.class,
      stream: s.stream,
      section: s.section,
      roll_number: s.roll_number,
      email_id: s.email_id,
      mobile_number: s.mobile_number,
      photo_url: s.student_photo_url,
      added_at: s.added_at,
      today_status: attMap[s.id]?.status || "not-marked",
      today_time: attMap[s.id]?.marked_time || null
    }));

    res.json({ success: true, assignment, date: dateStr, data: enriched, count: enriched.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/teacher/assignment/:assignmentId/student/:studentCode", authTeacher, async (req, res) => {
  try {
    const { assignmentId, studentCode } = req.params;

    const rows = await q(`SELECT n.id, n.name FROM Nstudent n WHERE n.student_id = ? LIMIT 1`, [studentCode]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Student not found" });

    const student = rows[0];
    const result = await q(
      `DELETE FROM teacher_students WHERE teacher_id = ? AND assignment_id = ? AND student_id = ?`,
      [req.teacher.id, assignmentId, student.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "Student not in this period's list" });
    }

    res.json({ success: true, message: `✅ ${student.name} removed` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/teacher/student/:studentCode/qr", authTeacher, async (req, res) => {
  try {
    const { studentCode } = req.params;

    const studentRows = await q(
      `SELECT id, student_id, name, class, roll_number FROM Nstudent 
       WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [studentCode]
    );
    if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const student = studentRows[0];

    const assign = await q(
      `SELECT id FROM assignments WHERE teacher_id = ? AND class = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, student.class]
    );
    if (!assign.length) {
      return res.status(403).json({ success: false, message: "You don't teach this student's class" });
    }

    const token = generateQRToken(student.student_id);
    const qrImage = await generateQRImage(token);

    res.json({
      success: true,
      data: {
        student_id: student.student_id,
        student_name: student.name,
        class: student.class,
        roll_number: student.roll_number,
        qr_token: token,
        qr_image: qrImage
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// REGISTER-STYLE MONTHLY REPORT (Har din ki column)
// GET /api/attendance/teacher/register-report?class=&month=&year=
// ═══════════════════════════════════════════════════════════════
router.get("/teacher/register-report", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year, assignmentId, studentIds } = req.query;

    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const assignCheck = await q(
      `SELECT id FROM assignments WHERE teacher_id = ? AND class = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls]
    );
    if (!assignCheck.length) {
      return res.status(403).json({ success: false, message: "You don't teach this class" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;
    const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

    // Fetch students
    let students;
    if (studentIds) {
      const ids = String(studentIds).split(",").map(v => v.trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ success: false, message: "No student IDs" });
      const ph = ids.map(() => "?").join(",");
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name, section
         FROM Nstudent WHERE student_id IN (${ph}) AND class = ?
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [...ids, cls]
      );
    } else {
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name, section
         FROM Nstudent WHERE class = ? AND status = 'Active'
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [cls]
      );
    }

    // Fetch all attendance records for that month
    let sql = `SELECT student_id, date_str, period, status, subject_name
               FROM attendance
               WHERE class = ? AND date_str LIKE ? AND teacher_id = ?`;
    const params = [cls, `${prefix}%`, req.teacher.id];

    if (assignmentId) {
      const a = await q(`SELECT subject_id, period FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND subject_id = ? AND period = ?`;
        params.push(a[0].subject_id, a[0].period);
      }
    }

    const records = await q(sql, params);

    // Group by student → date → status
    const grid = {}; // grid[student_id][dateStr] = 'P' | 'A' | 'L'
    const datesFound = new Set();

    records.forEach(r => {
      const sid = r.student_id;
      const d = r.date_str;
      datesFound.add(d);
      if (!grid[sid]) grid[sid] = {};
      // Priority: P > L > A (agar ek din me multiple period hain to sabse jyada count)
      if (!grid[sid][d]) {
        grid[sid][d] = r.status === 'present' ? 'P' : r.status === 'late' ? 'L' : 'A';
      } else {
        // Agar already mark hai, aur naya P aaya to P
        const cur = grid[sid][d];
        if (r.status === 'present') grid[sid][d] = 'P';
        else if (r.status === 'late' && cur === 'A') grid[sid][d] = 'L';
      }
    });

    // Sorted list of dates that have attendance in this month
    const sortedDates = Array.from(datesFound).sort();

    // Build per-student summary
    const studentsWithStats = students.map(s => {
      const dates = grid[s.id] || {};
      let present = 0, absent = 0, late = 0;
      Object.values(dates).forEach(v => {
        if (v === 'P') present++;
        else if (v === 'A') absent++;
        else if (v === 'L') late++;
      });
      const total = present + absent + late;
      return {
        ...s,
        dates,
        present, absent, late, total,
        percentage: total ? Math.round((present / total) * 100) : 0
      };
    });

    res.json({
      success: true,
      class: cls,
      month: Number(month),
      monthName: monthName(Number(month)),
      year: Number(year),
      daysInMonth,
      dates: sortedDates,
      students: studentsWithStats,
      count: studentsWithStats.length
    });
  } catch (err) {
    console.error("Register report error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// REGISTER REPORT — EXCEL (Har din ki column)
// GET /api/attendance/teacher/register-excel?class=&month=&year=
// ═══════════════════════════════════════════════════════════════
router.get("/teacher/register-excel", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year, assignmentId, studentIds } = req.query;
    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;
    const monthLabel = monthName(Number(month));
    const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

    let students;
    if (studentIds) {
      const ids = String(studentIds).split(",").map(v => v.trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ success: false, message: "No students" });
      const ph = ids.map(() => "?").join(",");
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE student_id IN (${ph}) AND class = ?
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [...ids, cls]
      );
    } else {
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE class = ? AND status = 'Active'
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [cls]
      );
    }

    let sql = `SELECT student_id, date_str, status FROM attendance
               WHERE class = ? AND date_str LIKE ? AND teacher_id = ?`;
    const params = [cls, `${prefix}%`, req.teacher.id];
    if (assignmentId) {
      const a = await q(`SELECT subject_id, period FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND subject_id = ? AND period = ?`;
        params.push(a[0].subject_id, a[0].period);
      }
    }
    const records = await q(sql, params);

    const grid = {};
    const datesSet = new Set();
    records.forEach(r => {
      datesSet.add(r.date_str);
      if (!grid[r.student_id]) grid[r.student_id] = {};
      if (!grid[r.student_id][r.date_str]) {
        grid[r.student_id][r.date_str] = r.status === 'present' ? 'P' : r.status === 'late' ? 'L' : 'A';
      } else {
        const cur = grid[r.student_id][r.date_str];
        if (r.status === 'present') grid[r.student_id][r.date_str] = 'P';
        else if (r.status === 'late' && cur === 'A') grid[r.student_id][r.date_str] = 'L';
      }
    });

    const sortedDates = Array.from(datesSet).sort();

    // Create Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "GSSS Shilla";
    const sheet = workbook.addWorksheet(`Class ${cls}`);

    // Title rows
    sheet.mergeCells(1, 1, 1, 5 + sortedDates.length);
    const t1 = sheet.getCell("A1");
    t1.value = `${SCHOOL.name}`;
    t1.font = { bold: true, size: 14, color: { argb: "FF0B1740" } };
    t1.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 28;

    sheet.mergeCells(2, 1, 2, 5 + sortedDates.length);
    const t2 = sheet.getCell("A2");
    t2.value = `Monthly Attendance Register — Class ${cls} — ${monthLabel} ${year}`;
    t2.font = { bold: true, size: 11, color: { argb: "FFC9972B" } };
    t2.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(2).height = 22;

    // Header row (row 3): S.No, Roll, ID, Name, Father, [Day 1, Day 2, ...], Present, Absent, %, Total
    const headerCells = ["S.No", "Roll", "Student ID", "Name", "Father"];
    sortedDates.forEach(d => {
      const day = Number(d.slice(-2));
      headerCells.push(String(day));
    });
    headerCells.push("P", "A", "L", "Total", "%");

    const headerRow = sheet.addRow(headerCells);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1740" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" }
      };
    });
    headerRow.height = 24;

    // Data rows
    students.forEach((s, idx) => {
      const dates = grid[s.id] || {};
      let present = 0, absent = 0, late = 0;
      const rowData = [idx + 1, s.roll_number || "-", s.student_id, s.name, s.father_name || "-"];

      sortedDates.forEach(d => {
        const v = dates[d] || "";
        rowData.push(v);
        if (v === 'P') present++;
        else if (v === 'A') absent++;
        else if (v === 'L') late++;
      });

      const total = present + absent + late;
      const pct = total ? Math.round((present / total) * 100) : 0;
      rowData.push(present, absent, late, total, pct + "%");

      const row = sheet.addRow(rowData);

      row.eachCell((cell, colNum) => {
        cell.alignment = { horizontal: colNum >= 6 ? "center" : "left", vertical: "middle" };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } }
        };

        // Color the P/A/L cells
        const cellValue = String(cell.value || "");
        if (cellValue === "P") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
          cell.font = { bold: true, color: { argb: "FF15803D" } };
        } else if (cellValue === "A") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
          cell.font = { bold: true, color: { argb: "FFDC2626" } };
        } else if (cellValue === "L") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
          cell.font = { bold: true, color: { argb: "FFD97706" } };
        }
      });

      // Last cell percentage
      const lastCell = row.getCell(rowData.length);
      const pctNum = parseInt(String(lastCell.value));
      lastCell.font = {
        bold: true,
        color: { argb: pctNum >= 75 ? "FF15803D" : pctNum >= 50 ? "FFD97706" : "FFDC2626" }
      };
    });

    // Column widths
    const widths = [{ width: 6 }, { width: 8 }, { width: 14 }, { width: 25 }, { width: 22 }];
    sortedDates.forEach(() => widths.push({ width: 4 }));
    widths.push({ width: 8 }, { width: 8 }, { width: 6 }, { width: 8 }, { width: 8 });
    sheet.columns = widths;

    // Freeze header
    sheet.views = [{ state: "frozen", xSplit: 5, ySplit: 3 }];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Register_Class${cls}_${monthLabel}_${year}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Register Excel error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// REGISTER REPORT — PDF (Har din ki column)
// GET /api/attendance/teacher/register-pdf?class=&month=&year=
// ═══════════════════════════════════════════════════════════════
router.get("/teacher/register-pdf", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year, assignmentId, studentIds } = req.query;
    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;
    const monthLabel = monthName(Number(month));

    let students;
    if (studentIds) {
      const ids = String(studentIds).split(",").map(v => v.trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ success: false, message: "No students" });
      const ph = ids.map(() => "?").join(",");
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE student_id IN (${ph}) AND class = ?
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [...ids, cls]
      );
    } else {
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE class = ? AND status = 'Active'
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [cls]
      );
    }

    let sql = `SELECT student_id, date_str, status FROM attendance
               WHERE class = ? AND date_str LIKE ? AND teacher_id = ?`;
    const params = [cls, `${prefix}%`, req.teacher.id];
    if (assignmentId) {
      const a = await q(`SELECT subject_id, period FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND subject_id = ? AND period = ?`;
        params.push(a[0].subject_id, a[0].period);
      }
    }
    const records = await q(sql, params);

    const grid = {};
    const datesSet = new Set();
    records.forEach(r => {
      datesSet.add(r.date_str);
      if (!grid[r.student_id]) grid[r.student_id] = {};
      if (!grid[r.student_id][r.date_str]) {
        grid[r.student_id][r.date_str] = r.status === 'present' ? 'P' : r.status === 'late' ? 'L' : 'A';
      } else {
        const cur = grid[r.student_id][r.date_str];
        if (r.status === 'present') grid[r.student_id][r.date_str] = 'P';
        else if (r.status === 'late' && cur === 'A') grid[r.student_id][r.date_str] = 'L';
      }
    });

    const sortedDates = Array.from(datesSet).sort();

    // PDF
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Register_Class${cls}_${monthLabel}_${year}.pdf"`);
    doc.pipe(res);

    const logoBuf = await fetchImageBuffer(SCHOOL.logoUrl);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const leftMargin = 30;
    const rightMargin = 30;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    let y = 30;

    // Header
    if (logoBuf) {
      try {
        doc.circle(leftMargin + 25, y + 25, 28).fill("#ffffff");
        doc.circle(leftMargin + 25, y + 25, 26).lineWidth(1).strokeColor("#c9972b").stroke();
        doc.image(logoBuf, leftMargin + 4, y + 4, { fit: [42, 42], align: "center", valign: "center" });
      } catch (e) {}
    }

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0B1740")
      .text(SCHOOL.name, leftMargin + 60, y + 2, { width: contentWidth - 60 });
    doc.font("Helvetica").fontSize(9).fillColor("#5a6a7e")
      .text(SCHOOL.address, leftMargin + 60, y + 22, { width: contentWidth - 60 });
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text(`Helpline: ${SCHOOL.helpline}`, leftMargin + 60, y + 35, { width: contentWidth - 60 });

    y += 60;

    doc.moveTo(leftMargin, y).lineTo(pageWidth - rightMargin, y).lineWidth(2).strokeColor("#c9972b").stroke();
    y += 15;

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#0B1740")
      .text(`MONTHLY ATTENDANCE REGISTER — CLASS ${cls}`, leftMargin, y, { width: contentWidth, align: "center" });
    y += 20;
    doc.font("Helvetica").fontSize(10).fillColor("#c9972b")
      .text(`${monthLabel} ${year}`, leftMargin, y, { width: contentWidth, align: "center" });
    y += 25;

    // Table columns: S.No, Roll, Name, Father, [dates...], P, A, %
    const fixedCols = [
      { key: "sno", label: "S.No", width: 28 },
      { key: "roll", label: "Roll", width: 34 },
      { key: "name", label: "Name", width: 130 },
      { key: "father", label: "Father", width: 110 }
    ];

    const dayColWidth = Math.min(20, Math.max(14, Math.floor((contentWidth - 28 - 34 - 130 - 110 - 80) / Math.max(sortedDates.length, 1))));
    const summaryCols = [
      { key: "p", label: "P", width: 22 },
      { key: "a", label: "A", width: 22 },
      { key: "l", label: "L", width: 20 },
      { key: "pct", label: "%", width: 30 }
    ];

    const tableStartX = leftMargin;
    const headerHeight = 26;
    const rowHeight = 20;

    // Draw header
    let cx = tableStartX;
    doc.rect(tableStartX, y, contentWidth, headerHeight).fill("#0B1740");

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
    fixedCols.forEach(c => {
      doc.text(c.label, cx + 2, y + 8, { width: c.width - 4, align: c.key === "name" || c.key === "father" ? "left" : "center" });
      cx += c.width;
    });

    // Day headers
    sortedDates.forEach(d => {
      const day = Number(d.slice(-2));
      doc.text(String(day), cx + 1, y + 8, { width: dayColWidth - 2, align: "center" });
      cx += dayColWidth;
    });

    // Summary headers
    summaryCols.forEach(c => {
      doc.text(c.label, cx + 1, y + 8, { width: c.width - 2, align: "center" });
      cx += c.width;
    });

    y += headerHeight;

    // Rows
    const bottomLimit = pageHeight - 40;
    let rowIdx = 0;

    for (const s of students) {
      if (y + rowHeight > bottomLimit) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
        y = 40;
        // Redraw header
        let hx = tableStartX;
        doc.rect(tableStartX, y, contentWidth, headerHeight).fill("#0B1740");
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
        fixedCols.forEach(c => {
          doc.text(c.label, hx + 2, y + 8, { width: c.width - 4, align: c.key === "name" || c.key === "father" ? "left" : "center" });
          hx += c.width;
        });
        sortedDates.forEach(d => {
          const day = Number(d.slice(-2));
          doc.text(String(day), hx + 1, y + 8, { width: dayColWidth - 2, align: "center" });
          hx += dayColWidth;
        });
        summaryCols.forEach(c => {
          doc.text(c.label, hx + 1, y + 8, { width: c.width - 2, align: "center" });
          hx += c.width;
        });
        y += headerHeight;
      }

      // Zebra row
      if (rowIdx % 2 === 0) doc.rect(tableStartX, y, contentWidth, rowHeight).fill("#f8fafc");
      else doc.rect(tableStartX, y, contentWidth, rowHeight).fill("#ffffff");
      doc.rect(tableStartX, y, contentWidth, rowHeight).lineWidth(0.2).stroke("#e2e8f0");

      let rx = tableStartX;
      let present = 0, absent = 0, late = 0;
      const dates = grid[s.id] || {};

      // Fixed cells
      doc.font("Helvetica").fontSize(7.5).fillColor("#0B1740")
        .text(String(rowIdx + 1), rx + 2, y + 6, { width: fixedCols[0].width - 4, align: "center" });
      rx += fixedCols[0].width;
      doc.text(String(s.roll_number || "-"), rx + 2, y + 6, { width: fixedCols[1].width - 4, align: "center" });
      rx += fixedCols[1].width;
      doc.text(String(s.name || "").slice(0, 22), rx + 2, y + 6, { width: fixedCols[2].width - 4, align: "left", lineBreak: false });
      rx += fixedCols[2].width;
      doc.text(String(s.father_name || "-").slice(0, 20), rx + 2, y + 6, { width: fixedCols[3].width - 4, align: "left", lineBreak: false });
      rx += fixedCols[3].width;

      // Day cells
      sortedDates.forEach(d => {
        const v = dates[d] || "";
        if (v === "P") {
          doc.rect(rx + 1, y + 3, dayColWidth - 2, rowHeight - 6).fill("#DCFCE7");
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#15803D")
            .text("P", rx + 1, y + 6, { width: dayColWidth - 2, align: "center" });
          present++;
        } else if (v === "A") {
          doc.rect(rx + 1, y + 3, dayColWidth - 2, rowHeight - 6).fill("#FEE2E2");
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#DC2626")
            .text("A", rx + 1, y + 6, { width: dayColWidth - 2, align: "center" });
          absent++;
        } else if (v === "L") {
          doc.rect(rx + 1, y + 3, dayColWidth - 2, rowHeight - 6).fill("#FEF3C7");
          doc.font("Helvetica-Bold").fontSize(7).fillColor("#D97706")
            .text("L", rx + 1, y + 6, { width: dayColWidth - 2, align: "center" });
          late++;
        }
        rx += dayColWidth;
      });

      // Summary cells
      const total = present + absent + late;
      const pct = total ? Math.round((present / total) * 100) : 0;
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#15803D")
        .text(String(present), rx + 1, y + 6, { width: summaryCols[0].width - 2, align: "center" });
      rx += summaryCols[0].width;
      doc.fillColor("#DC2626").text(String(absent), rx + 1, y + 6, { width: summaryCols[1].width - 2, align: "center" });
      rx += summaryCols[1].width;
      doc.fillColor("#D97706").text(String(late), rx + 1, y + 6, { width: summaryCols[2].width - 2, align: "center" });
      rx += summaryCols[2].width;
      doc.fillColor(pct >= 75 ? "#15803D" : pct >= 50 ? "#D97706" : "#DC2626")
        .text(pct + "%", rx + 1, y + 6, { width: summaryCols[3].width - 2, align: "center" });

      y += rowHeight;
      rowIdx++;
    }

    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8")
      .text(`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · GSSS Shilla Official Register`,
        leftMargin, pageHeight - 20, { width: contentWidth, align: "center" });

    doc.end();
  } catch (err) {
    console.error("Register PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});
// ═══════════════════════════════════════════════════════════════
// SCAN / LIVE / MANUAL / FINALIZE
// ═══════════════════════════════════════════════════════════════

router.post("/scan", authTeacher, async (req, res) => {
  try {
    const { qrToken, class: cls, subjectId, period } = req.body;
    if (!qrToken || !cls || !subjectId || !period) {
      return res.status(400).json({ success: false, message: "qrToken, class, subjectId, period required" });
    }

    const verified = verifyQRToken(String(qrToken).trim());
    if (!verified) {
      return res.status(400).json({ success: false, message: "❌ Invalid QR code", code: "INVALID_QR" });
    }

    const studentRows = await q(
      `SELECT * FROM Nstudent WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [verified.studentCode]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: "❌ Student not found or inactive", code: "STUDENT_NOT_FOUND" });
    }
    const student = studentRows[0];

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, Number(period)]
    );
    if (!assignRows.length) {
      return res.status(403).json({ success: false, message: "❌ You are not assigned to this period", code: "NOT_ASSIGNED" });
    }
    const assignment = assignRows[0];

    if (!isWithinWindow(assignment.start_time, assignment.end_time)) {
      return res.status(400).json({
        success: false,
        message: `⏰ Window closed. Window: ${assignment.start_time}-${assignment.end_time}. Now: ${nowHM()}`,
        code: "OUTSIDE_WINDOW"
      });
    }

    if (String(student.class) !== String(cls)) {
      return res.status(400).json({
        success: false,
        message: `❌ Student is from Class ${student.class}, not Class ${cls}`,
        code: "CLASS_MISMATCH"
      });
    }

    const inList = await q(
      `SELECT id FROM teacher_students 
       WHERE teacher_id = ? AND assignment_id = ? AND student_id = ? LIMIT 1`,
      [req.teacher.id, assignment.id, student.id]
    );
    if (!inList.length) {
      return res.status(400).json({
        success: false,
        message: `❌ ${student.name} is not in this period's list. Add student first.`,
        code: "NOT_IN_LIST"
      });
    }

    const dateStr = todayDateStr();
    const existing = await q(
      `SELECT * FROM attendance WHERE student_id = ? AND date_str = ? AND period = ? LIMIT 1`,
      [student.id, dateStr, Number(period)]
    );
    if (existing.length) {
      return res.json({
        success: true,
        alreadyMarked: true,
        message: `⚠️ ${student.name} already marked (${existing[0].marked_time})`,
        student: formatStudent(student)
      });
    }

    const late = isLateArrival(assignment.late_after);
    const status = late ? "late" : "present";
    const timeStr = nowTimeStr();

    const subRows = await q(`SELECT name FROM subjects WHERE id = ?`, [subjectId]);
    const subjectName = subRows[0]?.name || "";

    const result = await q(
      `INSERT INTO attendance 
        (student_id, student_code, student_name, roll_number, class, section,
         subject_id, subject_name, teacher_id, teacher_name,
         period, date, date_str, marked_at, marked_time,
         window_start, window_end, status, is_late, method, device_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, NOW(), ?, ?, ?, ?, ?, 'qr', ?)`,
      [
        student.id, student.student_id, student.name, student.roll_number || null,
        cls, student.section || null,
        subjectId, subjectName, req.teacher.id, req.teacher.name,
        Number(period), dateStr, timeStr,
        assignment.start_time, assignment.end_time,
        status, late ? 1 : 0,
        (req.headers["user-agent"] || "").slice(0, 250)
      ]
    );

    await q(
      `INSERT INTO student_absence_tracker (student_id, consecutive_absent_days, last_absent_date)
       VALUES (?, 0, NULL)
       ON DUPLICATE KEY UPDATE consecutive_absent_days = 0`,
      [student.id]
    );

    res.json({
      success: true,
      message: `✅ ${student.name} marked ${status.toUpperCase()}`,
      status, isLate: late, time: timeStr,
      student: formatStudent(student),
      attendance: { id: result.insertId, period: Number(period), class: cls, subject: subjectName, markedTime: timeStr }
    });
  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/live/:class/:subjectId/:period", authTeacher, async (req, res) => {
  try {
    const { class: cls, subjectId, period } = req.params;
    const dateStr = todayDateStr();

    const assignRows = await q(
      `SELECT id FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, Number(period)]
    );
    if (!assignRows.length) return res.status(403).json({ success: false, message: "Not assigned" });
    const assignmentId = assignRows[0].id;

    const myStudents = await q(
      `SELECT n.id, n.student_id, n.name, n.roll_number, n.section, n.student_photo_url
       FROM teacher_students ts
       JOIN Nstudent n ON n.id = ts.student_id
       WHERE ts.teacher_id = ? AND ts.assignment_id = ? AND n.status = 'Active'
       ORDER BY CAST(n.roll_number AS UNSIGNED), n.name ASC`,
      [req.teacher.id, assignmentId]
    );

    const marked = await q(
      `SELECT * FROM attendance
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND date_str = ?
       ORDER BY marked_at ASC`,
      [req.teacher.id, cls, subjectId, Number(period), dateStr]
    );

    const markedIds = marked.map(m => m.student_id);
    const absentStudents = myStudents.filter(s => !markedIds.includes(s.id));

    res.json({
      success: true,
      date: dateStr,
      currentTime: nowTimeStr(),
      data: marked,
      absent: absentStudents.map(s => ({
        id: s.id, student_id: s.student_id, name: s.name,
        roll_number: s.roll_number, section: s.section, photo_url: s.student_photo_url
      })),
      stats: {
        present: marked.length,
        absent: absentStudents.length,
        total: myStudents.length,
        percentage: myStudents.length ? Math.round((marked.length / myStudents.length) * 100) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/manual", authTeacher, async (req, res) => {
  try {
    const { studentId, class: cls, subjectId, period, status = "present" } = req.body;
    if (!studentId || !cls || !subjectId || !period) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, Number(period)]
    );
    if (!assignRows.length) return res.status(403).json({ success: false, message: "Not assigned" });
    const assignment = assignRows[0];

    if (!isWithinWindow(assignment.start_time, assignment.end_time)) {
      return res.status(400).json({ success: false, message: `⏰ Window closed` });
    }

    const inList = await q(
      `SELECT id FROM teacher_students 
       WHERE teacher_id = ? AND assignment_id = ? AND student_id = ? LIMIT 1`,
      [req.teacher.id, assignment.id, studentId]
    );
    if (!inList.length) {
      return res.status(400).json({ success: false, message: "Student not in this period's list" });
    }

    const studentRows = await q(`SELECT * FROM Nstudent WHERE id = ? AND class = ? LIMIT 1`, [studentId, cls]);
    if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const student = studentRows[0];

    const dateStr = todayDateStr();
    const timeStr = nowTimeStr();
    const subRows = await q(`SELECT name FROM subjects WHERE id = ?`, [subjectId]);

    await q(
      `INSERT INTO attendance
        (student_id, student_code, student_name, roll_number, class, section,
         subject_id, subject_name, teacher_id, teacher_name,
         period, date, date_str, marked_at, marked_time,
         window_start, window_end, status, is_late, method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, NOW(), ?, ?, ?, ?, 0, 'manual')
       ON DUPLICATE KEY UPDATE status = VALUES(status), method = 'manual', marked_time = VALUES(marked_time)`,
      [
        student.id, student.student_id, student.name, student.roll_number || null,
        cls, student.section || null,
        subjectId, subRows[0]?.name || "", req.teacher.id, req.teacher.name,
        Number(period), dateStr, timeStr,
        assignment.start_time, assignment.end_time, status
      ]
    );

    if (status === "present") {
      await q(
        `INSERT INTO student_absence_tracker (student_id, consecutive_absent_days)
         VALUES (?, 0) ON DUPLICATE KEY UPDATE consecutive_absent_days = 0`,
        [student.id]
      );
    }

    res.json({ success: true, message: `✅ ${student.name} marked ${status}`, student: formatStudent(student) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/finalize", authTeacher, async (req, res) => {
  try {
    const { class: cls, subjectId, period } = req.body;

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, Number(period)]
    );
    if (!assignRows.length) return res.status(403).json({ success: false, message: "Not assigned" });
    const assignment = assignRows[0];

    const dateStr = todayDateStr();
    const timeStr = nowTimeStr();

    const allStudents = await q(
      `SELECT n.id, n.student_id, n.name, n.roll_number, n.section
       FROM teacher_students ts
       JOIN Nstudent n ON n.id = ts.student_id
       WHERE ts.teacher_id = ? AND ts.assignment_id = ? AND n.status = 'Active'`,
      [req.teacher.id, assignment.id]
    );

    const marked = await q(
      `SELECT student_id FROM attendance WHERE class = ? AND period = ? AND date_str = ?`,
      [cls, Number(period), dateStr]
    );
    const markedIds = marked.map(m => m.student_id);

    const absentStudents = allStudents.filter(s => !markedIds.includes(s.id));
    const subRows = await q(`SELECT name FROM subjects WHERE id = ?`, [subjectId]);
    const subjectName = subRows[0]?.name || "";

    let inserted = 0;
    for (const s of absentStudents) {
      try {
        await q(
          `INSERT INTO attendance
            (student_id, student_code, student_name, roll_number, class, section,
             subject_id, subject_name, teacher_id, teacher_name,
             period, date, date_str, marked_at, marked_time,
             window_start, window_end, status, method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, NOW(), ?, ?, ?, 'absent', 'auto-absent')`,
          [
            s.id, s.student_id, s.name, s.roll_number || null,
            cls, s.section || null,
            subjectId, subjectName, req.teacher.id, req.teacher.name,
            Number(period), dateStr, timeStr,
            assignment.start_time, assignment.end_time
          ]
        );
        inserted++;

        await q(
          `INSERT INTO student_absence_tracker 
            (student_id, consecutive_absent_days, last_absent_date, total_absent_days)
           VALUES (?, 1, CURDATE(), 1)
           ON DUPLICATE KEY UPDATE 
             consecutive_absent_days = consecutive_absent_days + 1,
             last_absent_date = CURDATE(),
             total_absent_days = total_absent_days + 1,
             is_flagged = IF(consecutive_absent_days + 1 >= ?, 1, is_flagged),
             flagged_at = IF(consecutive_absent_days + 1 >= ?, NOW(), flagged_at)`,
          [s.id, ABSENT_AUTO_DELETE_DAYS, ABSENT_AUTO_DELETE_DAYS]
        );
      } catch (e) {}
    }

    res.json({
      success: true,
      message: `✅ Finalized. ${inserted} absent marked`,
      absentCount: inserted,
      date: dateStr,
      time: timeStr
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEACHER — HISTORY & REPORTS
// ═══════════════════════════════════════════════════════════════

// 1. DATE-WISE ATTENDANCE (kisi din ki)
router.get("/teacher/history/:assignmentId", authTeacher, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { date } = req.query;

    if (!date) return res.status(400).json({ success: false, message: "date required (YYYY-MM-DD)" });

    const assignRows = await q(
      `SELECT a.*, s.name AS subject_name, s.code AS subject_code
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       WHERE a.id = ? AND a.teacher_id = ? AND a.is_active = 1 LIMIT 1`,
      [assignmentId, req.teacher.id]
    );
    if (!assignRows.length) return res.status(404).json({ success: false, message: "Assignment not found" });
    const assignment = assignRows[0];

    const records = await q(
      `SELECT * FROM attendance
       WHERE teacher_id = ? AND class = ? AND subject_id = ?
         AND period = ? AND date_str = ?
       ORDER BY marked_time ASC`,
      [req.teacher.id, assignment.class, assignment.subject_id, assignment.period, date]
    );

    const allStudents = await q(
      `SELECT n.id, n.student_id, n.name, n.roll_number, n.section, n.student_photo_url
       FROM teacher_students ts
       JOIN Nstudent n ON n.id = ts.student_id
       WHERE ts.teacher_id = ? AND ts.assignment_id = ?
       ORDER BY CAST(n.roll_number AS UNSIGNED), n.name ASC`,
      [req.teacher.id, assignmentId]
    );

    const markedIds = records.map(r => r.student_id);
    const absentStudents = allStudents.filter(s => !markedIds.includes(s.id));

    res.json({
      success: true,
      assignment,
      date,
      present: records,
      absent: absentStudents,
      stats: {
        present: records.length,
        absent: absentStudents.length,
        total: allStudents.length,
        percentage: allStudents.length ? Math.round((records.length / allStudents.length) * 100) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. DATE-RANGE SUMMARY (7 din / 30 din)
router.get("/teacher/history-range/:assignmentId", authTeacher, async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { from, to } = req.query;

    const today = getISTDate();
    const fromDate = from || new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const toDate = to || today.toISOString().slice(0, 10);

    const assignRows = await q(
      `SELECT a.*, s.name AS subject_name, s.code AS subject_code
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       WHERE a.id = ? AND a.teacher_id = ? AND a.is_active = 1 LIMIT 1`,
      [assignmentId, req.teacher.id]
    );
    if (!assignRows.length) return res.status(404).json({ success: false, message: "Assignment not found" });
    const assignment = assignRows[0];

    const summary = await q(
      `SELECT 
         date_str,
         COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
         COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
         COUNT(CASE WHEN status = 'late' THEN 1 END) AS late_count,
         COUNT(*) AS total_marked
       FROM attendance
       WHERE teacher_id = ? AND class = ? AND subject_id = ?
         AND period = ? AND date_str BETWEEN ? AND ?
       GROUP BY date_str
       ORDER BY date_str DESC`,
      [req.teacher.id, assignment.class, assignment.subject_id, assignment.period, fromDate, toDate]
    );

    const totalStudents = await q(
      `SELECT COUNT(*) AS cnt FROM teacher_students
       WHERE teacher_id = ? AND assignment_id = ?`,
      [req.teacher.id, assignmentId]
    );

    res.json({
      success: true,
      assignment,
      from: fromDate,
      to: toDate,
      totalStudents: totalStudents[0]?.cnt || 0,
      data: summary
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. STUDENT MONTHLY REPORT
router.get("/teacher/student-report/:studentCode", authTeacher, async (req, res) => {
  try {
    const { studentCode } = req.params;
    const { month, year, assignmentId } = req.query;

    if (!month || !year) {
      return res.status(400).json({ success: false, message: "month and year required" });
    }

    const studentRows = await q(
      `SELECT id, student_id, name, class, roll_number, father_name, student_photo_url
       FROM Nstudent WHERE student_id = ? LIMIT 1`,
      [studentCode]
    );
    if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found" });
    const student = studentRows[0];

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;

    let sql = `SELECT * FROM attendance WHERE student_id = ? AND date_str LIKE ?`;
    const params = [student.id, `${prefix}%`];

    if (assignmentId) {
      const a = await q(`SELECT * FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND class = ? AND subject_id = ? AND period = ?`;
        params.push(a[0].class, a[0].subject_id, a[0].period);
      }
    } else {
      sql += ` AND teacher_id = ?`;
      params.push(req.teacher.id);
    }

    sql += ` ORDER BY date_str ASC, period ASC`;

    const records = await q(sql, params);

    const total = records.length;
    const present = records.filter(r => r.status === "present").length;
    const absent = records.filter(r => r.status === "absent").length;
    const late = records.filter(r => r.status === "late").length;

    res.json({
      success: true,
      student,
      month: Number(month),
      monthName: monthName(Number(month)),
      year: Number(year),
      data: records,
      summary: {
        total, present, absent, late,
        percentage: total ? Math.round((present / total) * 100) : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. CLASS MONTHLY SUMMARY
router.get("/teacher/class-report", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year } = req.query;

    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const assignCheck = await q(
      `SELECT id FROM assignments WHERE teacher_id = ? AND class = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls]
    );
    if (!assignCheck.length) {
      return res.status(403).json({ success: false, message: "You don't teach this class" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;

    const periodWise = await q(
      `SELECT 
        period,
        subject_name,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN status = 'late' THEN 1 END) AS late_count,
        COUNT(DISTINCT date_str) AS days_conducted
       FROM attendance
       WHERE teacher_id = ? AND class = ? AND date_str LIKE ?
       GROUP BY period, subject_name
       ORDER BY period ASC`,
      [req.teacher.id, cls, `${prefix}%`]
    );

    const dateWise = await q(
      `SELECT 
        date_str,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN status = 'late' THEN 1 END) AS late_count,
        COUNT(*) AS total_marked
       FROM attendance
       WHERE teacher_id = ? AND class = ? AND date_str LIKE ?
       GROUP BY date_str
       ORDER BY date_str DESC`,
      [req.teacher.id, cls, `${prefix}%`]
    );

    const totalStudents = await q(
      `SELECT COUNT(*) AS cnt FROM Nstudent WHERE class = ? AND status = 'Active'`,
      [cls]
    );

    res.json({
      success: true,
      class: cls,
      month: Number(month),
      monthName: monthName(Number(month)),
      year: Number(year),
      totalStudents: totalStudents[0]?.cnt || 0,
      periodWise,
      dateWise
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. CLASS-WISE STUDENT ATTENDANCE SUMMARY
router.get("/teacher/class-students-summary", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year, assignmentId } = req.query;

    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;

    // All students in class
    const students = await q(
      `SELECT id, student_id, name, roll_number, section, father_name, student_photo_url
       FROM Nstudent WHERE class = ? AND status = 'Active'
       ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
      [cls]
    );

    // Get attendance summary per student
    let sql = `SELECT 
        student_id,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN status = 'late' THEN 1 END) AS late_count,
        COUNT(*) AS total_count
      FROM attendance
      WHERE class = ? AND date_str LIKE ? AND teacher_id = ?`;
    const params = [cls, `${prefix}%`, req.teacher.id];

    if (assignmentId) {
      const a = await q(`SELECT * FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND subject_id = ? AND period = ?`;
        params.push(a[0].subject_id, a[0].period);
      }
    }

    sql += ` GROUP BY student_id`;

    const attSummary = await q(sql, params);
    const attMap = {};
    attSummary.forEach(a => { attMap[a.student_id] = a; });

    const enriched = students.map(s => {
      const att = attMap[s.id] || { present_count: 0, absent_count: 0, late_count: 0, total_count: 0 };
      return {
        ...s,
        present_count: att.present_count,
        absent_count: att.absent_count,
        late_count: att.late_count,
        total_count: att.total_count,
        percentage: att.total_count ? Math.round((att.present_count / att.total_count) * 100) : 0
      };
    });

    res.json({
      success: true,
      class: cls,
      month: Number(month),
      monthName: monthName(Number(month)),
      year: Number(year),
      data: enriched,
      count: enriched.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. EXPORT — CLASS STUDENTS SUMMARY EXCEL
router.get("/teacher/export/excel", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year, assignmentId, studentIds } = req.query;

    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;
    const monthLabel = monthName(Number(month));

    let students;

    if (studentIds) {
      // Selected students
      const ids = String(studentIds).split(",").map(v => v.trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ success: false, message: "No student IDs provided" });
      const ph = ids.map(() => "?").join(",");
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE student_id IN (${ph}) AND class = ?
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [...ids, cls]
      );
    } else {
      // All class students
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE class = ? AND status = 'Active'
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [cls]
      );
    }

    // Get attendance summary per student
    let sql = `SELECT 
        student_id,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN status = 'late' THEN 1 END) AS late_count,
        COUNT(*) AS total_count
      FROM attendance
      WHERE class = ? AND date_str LIKE ? AND teacher_id = ?`;
    const params = [cls, `${prefix}%`, req.teacher.id];

    if (assignmentId) {
      const a = await q(`SELECT * FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND subject_id = ? AND period = ?`;
        params.push(a[0].subject_id, a[0].period);
      }
    }

    sql += ` GROUP BY student_id`;
    const attSummary = await q(sql, params);
    const attMap = {};
    attSummary.forEach(a => { attMap[a.student_id] = a; });

    // Create Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "GSSS Shilla";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(`Class ${cls} - ${monthLabel}`);

    // Title row
    sheet.mergeCells("A1:F1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = `${SCHOOL.name}`;
    titleCell.font = { bold: true, size: 16, color: { argb: "FF0B1740" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;

    sheet.mergeCells("A2:F2");
    const subtitleCell = sheet.getCell("A2");
    subtitleCell.value = `Attendance Report — Class ${cls} — ${monthLabel} ${year}`;
    subtitleCell.font = { bold: true, size: 13, color: { argb: "FFC9972B" } };
    subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(2).height = 24;

    // Header row
    const headerRow = sheet.addRow([
      "S.No", "Roll No", "Student ID", "Name", "Father Name",
      "Present", "Absent", "Late", "Total Days", "Percentage"
    ]);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1740" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" }
      };
    });
    headerRow.height = 22;

    // Data rows
    students.forEach((s, idx) => {
      const att = attMap[s.id] || { present_count: 0, absent_count: 0, late_count: 0, total_count: 0 };
      const pct = att.total_count ? Math.round((att.present_count / att.total_count) * 100) : 0;

      const row = sheet.addRow([
        idx + 1,
        s.roll_number || "-",
        s.student_id,
        s.name,
        s.father_name || "-",
        att.present_count,
        att.absent_count,
        att.late_count,
        att.total_count,
        pct + "%"
      ]);

      row.eachCell((cell, colNum) => {
        cell.alignment = { horizontal: colNum >= 6 ? "center" : "left", vertical: "middle" };
        cell.border = {
          top: { style: "thin" }, left: { style: "thin" },
          bottom: { style: "thin" }, right: { style: "thin" }
        };
      });

      // Color code percentage
      if (pct >= 75) row.getCell(10).font = { bold: true, color: { argb: "FF15803D" } };
      else if (pct >= 50) row.getCell(10).font = { bold: true, color: { argb: "FFD97706" } };
      else row.getCell(10).font = { bold: true, color: { argb: "FFDC2626" } };
    });

    // Column widths
    sheet.columns = [
      { width: 6 }, { width: 10 }, { width: 14 }, { width: 25 }, { width: 22 },
      { width: 10 }, { width: 9 }, { width: 8 }, { width: 12 }, { width: 12 }
    ];

    // Footer
    sheet.addRow([]);
    const footerRow = sheet.addRow([
      `Generated on: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
    ]);
    sheet.mergeCells(`A${footerRow.number}:J${footerRow.number}`);
    footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF94A3B8" } };
    footerRow.getCell(1).alignment = { horizontal: "center" };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Attendance_Class${cls}_${monthLabel}_${year}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// 7. EXPORT — CLASS STUDENTS SUMMARY PDF
router.get("/teacher/export/pdf", authTeacher, async (req, res) => {
  try {
    const { class: cls, month, year, assignmentId, studentIds } = req.query;

    if (!cls || !month || !year) {
      return res.status(400).json({ success: false, message: "class, month, year required" });
    }

    const monthPadded = String(month).padStart(2, "0");
    const prefix = `${year}-${monthPadded}`;
    const monthLabel = monthName(Number(month));

    let students;
    if (studentIds) {
      const ids = String(studentIds).split(",").map(v => v.trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ success: false, message: "No student IDs provided" });
      const ph = ids.map(() => "?").join(",");
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE student_id IN (${ph}) AND class = ?
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [...ids, cls]
      );
    } else {
      students = await q(
        `SELECT id, student_id, name, roll_number, father_name
         FROM Nstudent WHERE class = ? AND status = 'Active'
         ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
        [cls]
      );
    }

    let sql = `SELECT 
        student_id,
        COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
        COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
        COUNT(CASE WHEN status = 'late' THEN 1 END) AS late_count,
        COUNT(*) AS total_count
      FROM attendance
      WHERE class = ? AND date_str LIKE ? AND teacher_id = ?`;
    const params = [cls, `${prefix}%`, req.teacher.id];

    if (assignmentId) {
      const a = await q(`SELECT * FROM assignments WHERE id = ? AND teacher_id = ?`, [assignmentId, req.teacher.id]);
      if (a.length) {
        sql += ` AND subject_id = ? AND period = ?`;
        params.push(a[0].subject_id, a[0].period);
      }
    }

    sql += ` GROUP BY student_id`;
    const attSummary = await q(sql, params);
    const attMap = {};
    attSummary.forEach(a => { attMap[a.student_id] = a; });

    // Create PDF
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Attendance_Class${cls}_${monthLabel}_${year}.pdf"`);
    doc.pipe(res);

    const logoBuf = await fetchImageBuffer(SCHOOL.logoUrl);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const leftMargin = 40;
    const rightMargin = 40;
    const contentWidth = pageWidth - leftMargin - rightMargin;

    // ─── HEADER ───────────────────────────────
    let y = 40;

    if (logoBuf) {
      try {
        doc.circle(leftMargin + 35, y + 35, 38).fill("#ffffff");
        doc.circle(leftMargin + 35, y + 35, 36).lineWidth(1.5).strokeColor("#c9972b").stroke();
        doc.image(logoBuf, leftMargin + 5, y + 5, { fit: [60, 60], align: "center", valign: "center" });
      } catch (e) {}
    }

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0B1740")
      .text(SCHOOL.name, leftMargin + 85, y + 4, { width: contentWidth - 85 });

    doc.font("Helvetica").fontSize(10).fillColor("#5a6a7e")
      .text(SCHOOL.address, leftMargin + 85, y + 32, { width: contentWidth - 85 });

    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
      .text(`Helpline: ${SCHOOL.helpline}`, leftMargin + 85, y + 48, { width: contentWidth - 85 });

    y += 90;

    // Border line
    doc.moveTo(leftMargin, y).lineTo(pageWidth - rightMargin, y).lineWidth(2).strokeColor("#c9972b").stroke();
    doc.moveTo(leftMargin, y + 3).lineTo(pageWidth - rightMargin, y + 3).lineWidth(0.5).strokeColor("#0B1740").stroke();

    y += 20;

    // ─── TITLE ───────────────────────────────
    const titleText = `MONTHLY ATTENDANCE REPORT — CLASS ${cls}`;
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0B1740")
      .text(titleText, leftMargin, y, { width: contentWidth, align: "center" });

    y += 22;

    doc.font("Helvetica").fontSize(11).fillColor("#c9972b")
      .text(`${monthLabel} ${year}`, leftMargin, y, { width: contentWidth, align: "center" });

    y += 25;

    // ─── SUMMARY BAR ─────────────────────────
    const summaryBoxHeight = 40;
    doc.roundedRect(leftMargin, y, contentWidth, summaryBoxHeight, 6).fillAndStroke("#fef8ed", "#c9972b");

    const totalStudents = students.length;
    const avgPresent = students.length
      ? Math.round(students.reduce((sum, s) => sum + (attMap[s.id]?.present_count || 0), 0) / students.length)
      : 0;

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0B1740")
      .text(`Total Students: ${totalStudents}`, leftMargin + 20, y + 14);

    doc.text(`Total Days (avg): ${avgPresent}`, leftMargin + 200, y + 14);

    doc.text(`Report Date: ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      pageWidth - rightMargin - 220, y + 14);

    y += summaryBoxHeight + 15;

    // ─── TABLE HEADER ────────────────────────
    const colWidths = [40, 60, 100, 200, 180, 70, 60, 55, 60, 80];
    const totalColWidth = colWidths.reduce((a, b) => a + b, 0);
    const tableWidth = Math.min(totalColWidth, contentWidth);
    const startX = leftMargin + (contentWidth - tableWidth) / 2;

    const headers = ["S.No", "Roll", "Student ID", "Name", "Father Name",
                     "Present", "Absent", "Late", "Total", "Percentage"];

    const headerHeight = 28;
    doc.rect(startX, y, tableWidth, headerHeight).fill("#0B1740");

    let headerX = startX;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
    headers.forEach((h, i) => {
      doc.text(h, headerX + 4, y + 9, { width: colWidths[i] - 8, align: i >= 5 ? "center" : "left" });
      headerX += colWidths[i];
    });

    y += headerHeight;

    // ─── ROWS ────────────────────────────────
    const rowHeight = 22;
    const bottomLimit = pageHeight - 60;
    let rowIdx = 0;

    for (const s of students) {
      if (y + rowHeight > bottomLimit) {
        // Page break
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });

        // Re-draw header
        y = 40;
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#0B1740")
          .text(titleText + " (continued)", leftMargin, y, { width: contentWidth, align: "center" });
        y += 30;

        doc.rect(startX, y, tableWidth, headerHeight).fill("#0B1740");
        let hx = startX;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
        headers.forEach((h, i) => {
          doc.text(h, hx + 4, y + 9, { width: colWidths[i] - 8, align: i >= 5 ? "center" : "left" });
          hx += colWidths[i];
        });
        y += headerHeight;
      }

      const att = attMap[s.id] || { present_count: 0, absent_count: 0, late_count: 0, total_count: 0 };
      const pct = att.total_count ? Math.round((att.present_count / att.total_count) * 100) : 0;

      // Zebra
      if (rowIdx % 2 === 0) {
        doc.rect(startX, y, tableWidth, rowHeight).fill("#f8fafc");
      } else {
        doc.rect(startX, y, tableWidth, rowHeight).fill("#ffffff");
      }

      // Border
      doc.rect(startX, y, tableWidth, rowHeight).lineWidth(0.3).stroke("#e2e8f0");

      const rowData = [
        String(rowIdx + 1),
        String(s.roll_number || "-"),
        String(s.student_id),
        String(s.name),
        String(s.father_name || "-"),
        String(att.present_count),
        String(att.absent_count),
        String(att.late_count),
        String(att.total_count),
        pct + "%"
      ];

      let cx = startX;
      rowData.forEach((val, i) => {
        let color = "#0B1740";
        if (i === 9) {
          color = pct >= 75 ? "#15803D" : pct >= 50 ? "#D97706" : "#DC2626";
        }
        doc.font(i === 9 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(color)
          .text(val, cx + 4, y + 7, { width: colWidths[i] - 8, align: i >= 5 ? "center" : "left", lineBreak: false });
        cx += colWidths[i];
      });

      y += rowHeight;
      rowIdx++;
    }

    // ─── FOOTER ─────────────────────────────
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text(
        `Generated on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · GSSS Shilla Official Report`,
        leftMargin, pageHeight - 30, { width: contentWidth, align: "center" }
      );

    doc.end();
  } catch (err) {
    console.error("PDF export error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES (Teachers, Subjects, Assignments)
// ═══════════════════════════════════════════════════════════════

router.post("/admin/teachers", authAdmin, async (req, res) => {
  try {
    const { teacher_id, name, email, phone, password, photo_url, photo_pid } = req.body;
    if (!teacher_id || !name || !email || !password) {
      return res.status(400).json({ success: false, message: "teacher_id, name, email, password required" });
    }
    if (password.length < 6) return res.status(400).json({ success: false, message: "Password min 6 chars" });

    const dup = await q(
      `SELECT id FROM teachers WHERE email = ? OR teacher_id = ?`,
      [email.toLowerCase().trim(), teacher_id]
    );
    if (dup.length) return res.status(400).json({ success: false, message: "Email or Teacher ID already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const result = await q(
      `INSERT INTO teachers (teacher_id, name, email, phone, password, photo_url, photo_pid, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [teacher_id, name, email.toLowerCase().trim(), phone || null, hashed, photo_url || null, photo_pid || null]
    );

    const teacher = (await q(
      `SELECT id, teacher_id, name, email, phone, photo_url, is_active FROM teachers WHERE id = ?`,
      [result.insertId]
    ))[0];

    res.status(201).json({ success: true, message: `✅ Teacher ${name} created`, data: teacher });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/admin/teachers", authAdmin, async (req, res) => {
  try {
    const teachers = await q(
      `SELECT id, teacher_id, name, email, phone, photo_url, is_active, created_at
       FROM teachers ORDER BY name ASC`
    );

    const withAssignments = await Promise.all(
      teachers.map(async (t) => {
        const assignments = await q(
          `SELECT a.*, s.name AS subject_name, s.code AS subject_code
           FROM assignments a JOIN subjects s ON s.id = a.subject_id
           WHERE a.teacher_id = ? AND a.is_active = 1
           ORDER BY a.class, a.period`,
          [t.id]
        );
        return { ...t, assignments };
      })
    );

    res.json({ success: true, data: withAssignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/admin/teachers/:id", authAdmin, async (req, res) => {
  try {
    const { name, email, phone, photo_url, photo_pid } = req.body;
    await q(
      `UPDATE teachers SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        photo_url = COALESCE(?, photo_url),
        photo_pid = COALESCE(?, photo_pid)
       WHERE id = ?`,
      [name || null, email ? email.toLowerCase().trim() : null, phone || null, photo_url || null, photo_pid || null, req.params.id]
    );
    res.json({ success: true, message: "✅ Teacher updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/admin/teachers/:id/toggle", authAdmin, async (req, res) => {
  try {
    const rows = await q(`SELECT is_active FROM teachers WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });
    const newStatus = rows[0].is_active ? 0 : 1;
    await q(`UPDATE teachers SET is_active = ? WHERE id = ?`, [newStatus, req.params.id]);
    res.json({ success: true, is_active: newStatus, message: newStatus ? "✅ Enabled" : "⚠️ Disabled" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/admin/teachers/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE teachers SET is_active = 0 WHERE id = ?`, [req.params.id]);
    await q(`UPDATE assignments SET is_active = 0 WHERE teacher_id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Teacher disabled" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/admin/teachers/:id/password", authAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: "Password min 6 chars" });
    const hashed = await bcrypt.hash(password, 10);
    await q(`UPDATE teachers SET password = ? WHERE id = ?`, [hashed, req.params.id]);
    res.json({ success: true, message: "✅ Password reset" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ASSIGNMENTS
router.post("/admin/teachers/:id/assign", authAdmin, async (req, res) => {
  try {
    const { subjectId, class: cls, section, period, days, startTime, endTime, lateAfter } = req.body;
    if (!subjectId || !cls || !period || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: "subjectId, class, period, startTime, endTime required" });
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ success: false, message: "Time format HH:MM" });
    }

    const t = await q(`SELECT id, name FROM teachers WHERE id = ?`, [req.params.id]);
    if (!t.length) return res.status(404).json({ success: false, message: "Teacher not found" });

    const sub = await q(`SELECT id, name FROM subjects WHERE id = ?`, [subjectId]);
    if (!sub.length) return res.status(404).json({ success: false, message: "Subject not found" });

    const dup = await q(
      `SELECT id FROM assignments 
       WHERE teacher_id = ? AND subject_id = ? AND class = ? AND period = ? AND is_active = 1`,
      [req.params.id, subjectId, cls, Number(period)]
    );
    if (dup.length) return res.status(400).json({ success: false, message: "This assignment already exists" });

    const daysStr = Array.isArray(days) && days.length ? days.join(",") : "Mon,Tue,Wed,Thu,Fri,Sat";

    const result = await q(
      `INSERT INTO assignments 
        (teacher_id, subject_id, class, section, period, days, start_time, end_time, late_after, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [req.params.id, subjectId, cls, section || null, Number(period), daysStr, startTime, endTime, lateAfter || null]
    );

    res.status(201).json({
      success: true,
      message: `✅ Assigned: Class ${cls} - ${sub[0].name} - P${period} (${startTime}-${endTime})`,
      data: { id: result.insertId, teacher_name: t[0].name, subject_name: sub[0].name }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE assignments SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Assignment removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// SUBJECTS
router.post("/admin/subjects", authAdmin, async (req, res) => {
  try {
    const { code, name, class: cls, stream } = req.body;
    if (!code || !name || !cls) return res.status(400).json({ success: false, message: "code, name, class required" });
    const result = await q(
      `INSERT INTO subjects (code, name, class, stream) VALUES (?, ?, ?, ?)`,
      [code, name, cls, stream || null]
    );
    res.status(201).json({ success: true, message: "✅ Subject created", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ success: false, message: "Subject code already exists" });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/admin/subjects", authAdmin, async (req, res) => {
  try {
    const { class: cls } = req.query;
    let sql = `SELECT * FROM subjects WHERE is_active = 1`;
    const params = [];
    if (cls) { sql += ` AND class = ?`; params.push(cls); }
    sql += ` ORDER BY class, name`;
    const rows = await q(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/admin/subjects/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE subjects SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Subject removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// QR
router.get("/qr/student/:studentCode", async (req, res) => {
  try {
    const { studentCode } = req.params;
    const studentRows = await q(
      `SELECT id, student_id, name, class FROM Nstudent WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [studentCode]
    );
    if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found" });

    const token = generateQRToken(studentRows[0].student_id);
    const qrImage = await generateQRImage(token);

    res.json({
      success: true,
      data: {
        student_id: studentRows[0].student_id,
        student_name: studentRows[0].name,
        class: studentRows[0].class,
        qr_token: token,
        qr_image: qrImage
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ADMIN — REPORTS / STATS
router.get("/reports/stats", authAdmin, async (req, res) => {
  try {
    const dateStr = todayDateStr();
    const totalStudents = await q(`SELECT COUNT(*) AS cnt FROM Nstudent WHERE status = 'Active'`);
    const totalTeachers = await q(`SELECT COUNT(*) AS cnt FROM teachers WHERE is_active = 1`);
    const todayPresent = await q(
      `SELECT COUNT(DISTINCT student_id) AS cnt FROM attendance WHERE date_str = ? AND status IN ('present','late')`,
      [dateStr]
    );
    const flaggedStudents = await q(
      `SELECT COUNT(*) AS cnt FROM student_absence_tracker WHERE consecutive_absent_days >= ? AND auto_deleted = 0`,
      [ABSENT_AUTO_DELETE_DAYS]
    );
    const autoDeleted = await q(`SELECT COUNT(*) AS cnt FROM student_absence_tracker WHERE auto_deleted = 1`);

    res.json({
      success: true,
      date: dateStr,
      stats: {
        totalStudents: totalStudents[0]?.cnt || 0,
        totalTeachers: totalTeachers[0]?.cnt || 0,
        todayPresent: todayPresent[0]?.cnt || 0,
        flaggedStudents: flaggedStudents[0]?.cnt || 0,
        autoDeleted: autoDeleted[0]?.cnt || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/reports/at-risk", authAdmin, async (req, res) => {
  try {
    const rows = await q(
      `SELECT sat.*, n.name, n.student_id AS code, n.class, n.roll_number, n.mobile_number, n.father_name
       FROM student_absence_tracker sat
       JOIN Nstudent n ON n.id = sat.student_id
       WHERE sat.consecutive_absent_days >= 1
       ORDER BY sat.consecutive_absent_days DESC, n.class`
    );
    res.json({ success: true, threshold: ABSENT_AUTO_DELETE_DAYS, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/run-auto-delete", authAdmin, async (req, res) => {
  try {
    const count = await autoDeleteAbsentStudents();
    res.json({ success: true, message: `✅ Auto-delete complete. ${count} students removed`, deletedCount: count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/recover-student/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE Nstudent SET status = 'Active', promotion_date = NULL WHERE id = ?`, [req.params.id]);
    await q(
      `UPDATE student_absence_tracker SET auto_deleted = 0, consecutive_absent_days = 0, is_flagged = 0, deleted_at = NULL WHERE student_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, message: "✅ Student recovered" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
