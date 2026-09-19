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

const db = require("../config/db");

const q = (sql, params = []) => db.query(sql, params);

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || "gsss-shilla-jwt-secret-2026";
const QR_SECRET = process.env.QR_SECRET || "gsss-shilla-qr-secret-2026";
const ABSENT_AUTO_DELETE_DAYS = 5;
const VERIFY_PREFIX = "https://gsssshilla07.pages.dev/verify/";

// ═══════════════════════════════════════════════════════════════
// QR TOKEN FUNCTIONS (inline)
// ═══════════════════════════════════════════════════════════════
function generateQRToken(studentCode) {
  return `${VERIFY_PREFIX}${encodeURIComponent(studentCode)}`;
}

function verifyQRToken(token) {
  if (!token || typeof token !== "string") return null;
  const clean = token.trim();

  // Format 1: URL format (aapka ID card QR)
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

  // Format 2: Plain student_id
  if (/^[A-Z0-9_\-]+$/i.test(clean) && clean.length >= 2 && clean.length <= 50) {
    return { studentCode: clean };
  }

  // Format 3: Signed GSSS:xxx:yyy:zzz
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
// TIME HELPERS
// ═══════════════════════════════════════════════════════════════
function todayDay() {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
}

function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function hmToMin(hm) {
  if (!hm) return 0;
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

function isWithinWindow(startTime, endTime) {
  const cur = hmToMin(nowHM());
  return cur >= hmToMin(startTime) && cur <= hmToMin(endTime);
}

function isLateArrival(lateAfter) {
  if (!lateAfter) return false;
  return hmToMin(nowHM()) > hmToMin(lateAfter);
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

    // ✅ Multiple admin roles accept
    const adminRoles = ["admin", "super admin", "superadmin", "super_admin", "super-admin"];
    const userRole = String(decoded.role || "").toLowerCase().trim();
    if (!adminRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Admin only. Your role: ${decoded.role || "unknown"}`
      });
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
      return res.status(403).json({
        success: false,
        message: `Teacher only. Your role: ${decoded.role || "unknown"}`
      });
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
// AUTO-DELETE ABSENT (5 din)
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
        await q(
          `UPDATE Nstudent SET status = 'Auto-Deleted', promotion_date = NOW() WHERE id = ?`,
          [s.student_id]
        );
        await q(
          `UPDATE student_absence_tracker 
           SET auto_deleted = 1, deleted_at = NOW(), is_flagged = 1, flagged_at = NOW()
           WHERE student_id = ?`,
          [s.student_id]
        );
        console.log(`🗑️ Auto-deleted: ${s.name} (${s.code})`);
        count++;
      } catch (e) {
        console.error("Auto-delete row error:", e.message);
      }
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
// HELPER
// ═══════════════════════════════════════════════════════════════
function formatStudent(s) {
  return {
    id: s.id,
    student_id: s.student_id,
    name: s.name,
    roll_number: s.roll_number,
    class: s.class,
    section: s.section,
    photo_url: s.student_photo_url
  };
}

// ═══════════════════════════════════════════════════════════════
// ══════════════ TEACHER AUTH ══════════════════════════════════
// ═══════════════════════════════════════════════════════════════

// POST /api/attendance/teacher/login
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
    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const teacher = rows[0];
    const ok = await bcrypt.compare(password, teacher.password);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

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
    console.error("Teacher login error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/teacher/my-periods
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
          `SELECT COUNT(*) AS cnt FROM Nstudent WHERE class = ? AND status = 'Active'`,
          [a.class]
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
// TEACHER — MY CLASSES + STUDENTS
// ═══════════════════════════════════════════════════════════════

// GET /api/attendance/teacher/my-classes
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
    console.error("My classes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/teacher/class/:class/students
router.get("/teacher/class/:class/students", authTeacher, async (req, res) => {
  try {
    const cls = req.params.class;

    // Verify teacher assigned to this class
    const assign = await q(
      `SELECT id FROM assignments 
       WHERE teacher_id = ? AND class = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls]
    );
    if (!assign.length) {
      return res.status(403).json({
        success: false,
        message: `You are not assigned to Class ${cls}`
      });
    }

    const students = await q(
      `SELECT id, student_id, name, father_name, mother_name, roll_number,
              class, section, student_photo_url, mobile_number
       FROM Nstudent 
       WHERE class = ? AND status = 'Active'
       ORDER BY CAST(roll_number AS UNSIGNED), name ASC`,
      [cls]
    );

    // Aaj ka attendance
    const dateStr = todayDateStr();
    const todayAtt = await q(
      `SELECT student_id, status, marked_time 
       FROM attendance 
       WHERE class = ? AND date_str = ?`,
      [cls, dateStr]
    );

    const attMap = {};
    todayAtt.forEach(a => { attMap[a.student_id] = a; });

    const enriched = students.map(s => ({
      ...s,
      today_status: attMap[s.id]?.status || "not-marked",
      today_time: attMap[s.id]?.marked_time || null
    }));

    res.json({
      success: true,
      class: cls,
      date: dateStr,
      data: enriched,
      count: enriched.length
    });
  } catch (err) {
    console.error("Class students error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/teacher/student/:studentCode/qr
router.get("/teacher/student/:studentCode/qr", authTeacher, async (req, res) => {
  try {
    const { studentCode } = req.params;

    const studentRows = await q(
      `SELECT id, student_id, name, class, roll_number FROM Nstudent 
       WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [studentCode]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    const student = studentRows[0];

    // Teacher teaches this class?
    const assign = await q(
      `SELECT id FROM assignments 
       WHERE teacher_id = ? AND class = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, student.class]
    );
    if (!assign.length) {
      return res.status(403).json({
        success: false,
        message: "You don't teach this student's class"
      });
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
    console.error("Student QR error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE SCAN
// ═══════════════════════════════════════════════════════════════

// POST /api/attendance/scan
router.post("/scan", authTeacher, async (req, res) => {
  try {
    const { qrToken, class: cls, subjectId, period } = req.body;

    if (!qrToken || !cls || !subjectId || !period) {
      return res.status(400).json({
        success: false,
        message: "qrToken, class, subjectId, period required"
      });
    }

    const verified = verifyQRToken(String(qrToken).trim());
    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "❌ Invalid QR code. Ye GSSS Shilla ka QR nahi hai.",
        code: "INVALID_QR"
      });
    }

    const studentRows = await q(
      `SELECT * FROM Nstudent WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [verified.studentCode]
    );
    if (!studentRows.length) {
      return res.status(404).json({
        success: false,
        message: "❌ Student not found or inactive",
        code: "STUDENT_NOT_FOUND"
      });
    }
    const student = studentRows[0];

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, Number(period)]
    );
    if (!assignRows.length) {
      return res.status(403).json({
        success: false,
        message: "❌ Aap is class/subject/period ke liye assigned nahi ho",
        code: "NOT_ASSIGNED"
      });
    }
    const assignment = assignRows[0];

    if (!isWithinWindow(assignment.start_time, assignment.end_time)) {
      return res.status(400).json({
        success: false,
        message: `⏰ Window band. Window: ${assignment.start_time}-${assignment.end_time}. Abhi: ${nowHM()}`,
        code: "OUTSIDE_WINDOW",
        window: { start: assignment.start_time, end: assignment.end_time },
        currentTime: nowHM()
      });
    }

    if (String(student.class) !== String(cls)) {
      return res.status(400).json({
        success: false,
        message: `❌ Ye student Class ${student.class} ka hai, Class ${cls} me nahi`,
        code: "CLASS_MISMATCH"
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
        message: `⚠️ ${student.name} ki attendance already marked (${existing[0].marked_time})`,
        student: formatStudent(student),
        attendance: existing[0]
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
      status,
      isLate: late,
      time: timeStr,
      student: formatStudent(student),
      attendance: {
        id: result.insertId,
        period: Number(period),
        class: cls,
        subject: subjectName,
        markedAt: new Date().toISOString(),
        markedTime: timeStr
      }
    });
  } catch (err) {
    console.error("❌ Scan error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/live/:class/:subjectId/:period
router.get("/live/:class/:subjectId/:period", authTeacher, async (req, res) => {
  try {
    const { class: cls, subjectId, period } = req.params;
    const dateStr = todayDateStr();

    const records = await q(
      `SELECT * FROM attendance
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND date_str = ?
       ORDER BY marked_at ASC`,
      [req.teacher.id, cls, subjectId, Number(period), dateStr]
    );

    const allStudents = await q(
      `SELECT id, student_id, name, roll_number, section, student_photo_url
       FROM Nstudent WHERE class = ? AND status = 'Active'
       ORDER BY CAST(roll_number AS UNSIGNED), name`,
      [cls]
    );

    const presentIds = records.map(r => r.student_id);
    const absentStudents = allStudents.filter(s => !presentIds.includes(s.id));

    res.json({
      success: true,
      date: dateStr,
      currentTime: nowTimeStr(),
      data: records,
      absent: absentStudents.map(s => ({
        id: s.id,
        student_id: s.student_id,
        name: s.name,
        roll_number: s.roll_number,
        section: s.section,
        photo_url: s.student_photo_url
      })),
      stats: {
        present: records.length,
        absent: absentStudents.length,
        total: allStudents.length,
        percentage: allStudents.length
          ? Math.round((records.length / allStudents.length) * 100)
          : 0
      }
    });
  } catch (err) {
    console.error("Live error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/attendance/manual
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
    if (!assignRows.length) {
      return res.status(403).json({ success: false, message: "Not assigned" });
    }
    const assignment = assignRows[0];

    if (!isWithinWindow(assignment.start_time, assignment.end_time)) {
      return res.status(400).json({
        success: false,
        message: `⏰ Window band. Window: ${assignment.start_time}-${assignment.end_time}`
      });
    }

    const studentRows = await q(
      `SELECT * FROM Nstudent WHERE id = ? AND class = ? AND status = 'Active' LIMIT 1`,
      [studentId, cls]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: "Student not found in class" });
    }
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

    res.json({
      success: true,
      message: `✅ ${student.name} marked ${status} (manual)`,
      student: formatStudent(student)
    });
  } catch (err) {
    console.error("Manual error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/attendance/finalize
router.post("/finalize", authTeacher, async (req, res) => {
  try {
    const { class: cls, subjectId, period } = req.body;

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, Number(period)]
    );
    if (!assignRows.length) {
      return res.status(403).json({ success: false, message: "Not assigned" });
    }
    const assignment = assignRows[0];

    const dateStr = todayDateStr();
    const timeStr = nowTimeStr();

    const allStudents = await q(
      `SELECT id, student_id, name, roll_number, section
       FROM Nstudent WHERE class = ? AND status = 'Active'`,
      [cls]
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
    console.error("Finalize error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN — TEACHERS
// ═══════════════════════════════════════════════════════════════

// POST /api/attendance/admin/teachers
router.post("/admin/teachers", authAdmin, async (req, res) => {
  try {
    const { teacher_id, name, email, phone, password, photo_url, photo_pid } = req.body;

    if (!teacher_id || !name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "teacher_id, name, email, password required"
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password min 6 chars" });
    }

    const dup = await q(
      `SELECT id FROM teachers WHERE email = ? OR teacher_id = ?`,
      [email.toLowerCase().trim(), teacher_id]
    );
    if (dup.length) {
      return res.status(400).json({
        success: false,
        message: "Email or Teacher ID already exists"
      });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await q(
      `INSERT INTO teachers (teacher_id, name, email, phone, password, photo_url, photo_pid, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        teacher_id, name, email.toLowerCase().trim(),
        phone || null, hashed,
        photo_url || null, photo_pid || null
      ]
    );

    const teacher = (await q(
      `SELECT id, teacher_id, name, email, phone, photo_url, is_active, created_at
       FROM teachers WHERE id = ?`,
      [result.insertId]
    ))[0];

    res.status(201).json({
      success: true,
      message: `✅ Teacher ${name} created`,
      data: teacher
    });
  } catch (err) {
    console.error("Create teacher error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/admin/teachers
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
           FROM assignments a
           JOIN subjects s ON s.id = a.subject_id
           WHERE a.teacher_id = ? AND a.is_active = 1
           ORDER BY a.class, a.period`,
          [t.id]
        );
        return { ...t, assignments };
      })
    );

    res.json({ success: true, data: withAssignments });
  } catch (err) {
    console.error("List teachers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/admin/teachers/:id
router.get("/admin/teachers/:id", authAdmin, async (req, res) => {
  try {
    const rows = await q(
      `SELECT id, teacher_id, name, email, phone, photo_url, is_active, created_at
       FROM teachers WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

    const assignments = await q(
      `SELECT a.*, s.name AS subject_name, s.code AS subject_code
       FROM assignments a JOIN subjects s ON s.id = a.subject_id
       WHERE a.teacher_id = ? AND a.is_active = 1`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...rows[0], assignments } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/attendance/admin/teachers/:id
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
      [
        name || null,
        email ? email.toLowerCase().trim() : null,
        phone || null,
        photo_url || null,
        photo_pid || null,
        req.params.id
      ]
    );

    res.json({ success: true, message: "✅ Teacher updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/attendance/admin/teachers/:id/toggle
router.patch("/admin/teachers/:id/toggle", authAdmin, async (req, res) => {
  try {
    const rows = await q(`SELECT is_active FROM teachers WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Not found" });

    const newStatus = rows[0].is_active ? 0 : 1;
    await q(`UPDATE teachers SET is_active = ? WHERE id = ?`, [newStatus, req.params.id]);

    res.json({
      success: true,
      is_active: newStatus,
      message: newStatus ? "✅ Enabled" : "⚠️ Disabled"
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/attendance/admin/teachers/:id
router.delete("/admin/teachers/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE teachers SET is_active = 0 WHERE id = ?`, [req.params.id]);
    await q(`UPDATE assignments SET is_active = 0 WHERE teacher_id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Teacher disabled" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/attendance/admin/teachers/:id/password
router.patch("/admin/teachers/:id/password", authAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password min 6 chars" });
    }
    const hashed = await bcrypt.hash(password, 10);
    await q(`UPDATE teachers SET password = ? WHERE id = ?`, [hashed, req.params.id]);
    res.json({ success: true, message: "✅ Password reset" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN — ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════

// POST /api/attendance/admin/teachers/:id/assign
router.post("/admin/teachers/:id/assign", authAdmin, async (req, res) => {
  try {
    const { subjectId, class: cls, section, period, days, startTime, endTime, lateAfter } = req.body;

    if (!subjectId || !cls || !period || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "subjectId, class, period, startTime, endTime required"
      });
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ success: false, message: "Time format HH:MM" });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ success: false, message: "startTime < endTime" });
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
    if (dup.length) {
      return res.status(400).json({ success: false, message: "This assignment already exists" });
    }

    const daysStr = Array.isArray(days) && days.length
      ? days.join(",")
      : "Mon,Tue,Wed,Thu,Fri,Sat";

    const result = await q(
      `INSERT INTO assignments 
        (teacher_id, subject_id, class, section, period, days, start_time, end_time, late_after, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        req.params.id, subjectId, cls,
        section || null, Number(period),
        daysStr, startTime, endTime, lateAfter || null
      ]
    );

    res.status(201).json({
      success: true,
      message: `✅ Assigned: Class ${cls} - ${sub[0].name} - P${period} (${startTime}-${endTime})`,
      data: {
        id: result.insertId,
        teacher_id: Number(req.params.id),
        teacher_name: t[0].name,
        subject_id: Number(subjectId),
        subject_name: sub[0].name,
        class: cls, section, period: Number(period), days: daysStr,
        start_time: startTime, end_time: endTime, late_after: lateAfter
      }
    });
  } catch (err) {
    console.error("Assign error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/attendance/admin/assignments/:id
router.delete("/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE assignments SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Assignment removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/attendance/admin/assignments/:id
router.put("/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    const { startTime, endTime, lateAfter, days, period } = req.body;
    await q(
      `UPDATE assignments SET
        start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time),
        late_after = COALESCE(?, late_after),
        days = COALESCE(?, days),
        period = COALESCE(?, period)
       WHERE id = ?`,
      [startTime || null, endTime || null, lateAfter || null, days || null, period || null, req.params.id]
    );
    res.json({ success: true, message: "✅ Assignment updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN — SUBJECTS
// ═══════════════════════════════════════════════════════════════

// POST /api/attendance/admin/subjects
router.post("/admin/subjects", authAdmin, async (req, res) => {
  try {
    const { code, name, class: cls, stream } = req.body;
    if (!code || !name || !cls) {
      return res.status(400).json({ success: false, message: "code, name, class required" });
    }
    const result = await q(
      `INSERT INTO subjects (code, name, class, stream) VALUES (?, ?, ?, ?)`,
      [code, name, cls, stream || null]
    );
    res.status(201).json({ success: true, message: "✅ Subject created", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ success: false, message: "Subject code already exists" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/admin/subjects
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

// DELETE /api/attendance/admin/subjects/:id
router.delete("/admin/subjects/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE subjects SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Subject removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// QR GENERATION
// ═══════════════════════════════════════════════════════════════

// GET /api/attendance/qr/student/:studentCode
router.get("/qr/student/:studentCode", async (req, res) => {
  try {
    const { studentCode } = req.params;

    const studentRows = await q(
      `SELECT id, student_id, name, class FROM Nstudent 
       WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [studentCode]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    const student = studentRows[0];

    const token = generateQRToken(student.student_id);
    const qrImage = await generateQRImage(token);

    res.json({
      success: true,
      data: {
        student_id: student.student_id,
        student_name: student.name,
        class: student.class,
        qr_token: token,
        qr_image: qrImage
      }
    });
  } catch (err) {
    console.error("QR error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/attendance/qr/generate-class/:class
router.post("/qr/generate-class/:class", authAdmin, async (req, res) => {
  try {
    const { class: cls } = req.params;
    const students = await q(
      `SELECT id, student_id, name FROM Nstudent WHERE class = ? AND status = 'Active'`,
      [cls]
    );

    res.json({
      success: true,
      message: `✅ ${students.length} students found in Class ${cls}. Use QR view to see individual QR.`,
      total: students.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════

// GET /api/attendance/reports/student/:studentCode
router.get("/reports/student/:studentCode", authAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const { studentCode } = req.params;

    const studentRows = await q(
      `SELECT id, name, class, roll_number FROM Nstudent WHERE student_id = ?`,
      [studentCode]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    const student = studentRows[0];

    let sql = `SELECT * FROM attendance WHERE student_code = ?`;
    const params = [studentCode];
    if (from) { sql += ` AND date >= ?`; params.push(from); }
    if (to) { sql += ` AND date <= ?`; params.push(to); }
    sql += ` ORDER BY date DESC, period DESC`;

    const records = await q(sql, params);
    const total = records.length;
    const present = records.filter(r => r.status === "present").length;
    const absent = records.filter(r => r.status === "absent").length;
    const late = records.filter(r => r.status === "late").length;

    res.json({
      success: true,
      student,
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

// GET /api/attendance/reports/class/:class
router.get("/reports/class/:class", authAdmin, async (req, res) => {
  try {
    const { date, period, subjectId } = req.query;
    const { class: cls } = req.params;

    let sql = `SELECT * FROM attendance WHERE class = ?`;
    const params = [cls];
    if (date) { sql += ` AND date_str = ?`; params.push(date); }
    if (period) { sql += ` AND period = ?`; params.push(Number(period)); }
    if (subjectId) { sql += ` AND subject_id = ?`; params.push(subjectId); }
    sql += ` ORDER BY date DESC, period ASC`;

    const records = await q(sql, params);
    res.json({ success: true, data: records, count: records.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/reports/stats
router.get("/reports/stats", authAdmin, async (req, res) => {
  try {
    const dateStr = todayDateStr();

    const totalStudents = await q(
      `SELECT COUNT(*) AS cnt FROM Nstudent WHERE status = 'Active'`
    );
    const totalTeachers = await q(
      `SELECT COUNT(*) AS cnt FROM teachers WHERE is_active = 1`
    );
    const todayPresent = await q(
      `SELECT COUNT(DISTINCT student_id) AS cnt FROM attendance 
       WHERE date_str = ? AND status IN ('present','late')`,
      [dateStr]
    );
    const flaggedStudents = await q(
      `SELECT COUNT(*) AS cnt FROM student_absence_tracker 
       WHERE consecutive_absent_days >= ? AND auto_deleted = 0`,
      [ABSENT_AUTO_DELETE_DAYS]
    );
    const autoDeleted = await q(
      `SELECT COUNT(*) AS cnt FROM student_absence_tracker WHERE auto_deleted = 1`
    );
    const classWise = await q(
      `SELECT class, COUNT(DISTINCT student_id) AS present
       FROM attendance WHERE date_str = ? AND status IN ('present','late')
       GROUP BY class`,
      [dateStr]
    );

    res.json({
      success: true,
      date: dateStr,
      stats: {
        totalStudents: totalStudents[0]?.cnt || 0,
        totalTeachers: totalTeachers[0]?.cnt || 0,
        todayPresent: todayPresent[0]?.cnt || 0,
        flaggedStudents: flaggedStudents[0]?.cnt || 0,
        autoDeleted: autoDeleted[0]?.cnt || 0,
        classWise
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/attendance/reports/at-risk
router.get("/reports/at-risk", authAdmin, async (req, res) => {
  try {
    const rows = await q(
      `SELECT 
        sat.*,
        n.name, n.student_id AS code, n.class, n.roll_number, n.mobile_number,
        n.father_name
       FROM student_absence_tracker sat
       JOIN Nstudent n ON n.id = sat.student_id
       WHERE sat.consecutive_absent_days >= 1
       ORDER BY sat.consecutive_absent_days DESC, n.class`
    );

    res.json({
      success: true,
      threshold: ABSENT_AUTO_DELETE_DAYS,
      data: rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/attendance/admin/run-auto-delete
router.post("/admin/run-auto-delete", authAdmin, async (req, res) => {
  try {
    const count = await autoDeleteAbsentStudents();
    res.json({
      success: true,
      message: `✅ Auto-delete complete. ${count} students removed`,
      deletedCount: count
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/attendance/admin/recover-student/:id
router.post("/admin/recover-student/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE Nstudent SET status = 'Active', promotion_date = NULL WHERE id = ?`, [req.params.id]);
    await q(
      `UPDATE student_absence_tracker 
       SET auto_deleted = 0, consecutive_absent_days = 0, is_flagged = 0, deleted_at = NULL
       WHERE student_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, message: "✅ Student recovered" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
