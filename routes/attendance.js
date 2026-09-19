// routes/attendance.js
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

const db = require("../config/db");

// ============================================================
// CONFIG
// ============================================================
const QR_SECRET = process.env.QR_SECRET || "gsss-shilla-qr-secret-2026";
const JWT_SECRET = process.env.JWT_SECRET || "gsss-shilla-jwt-secret-2026";
const ABSENT_AUTO_DELETE_DAYS = 5; // 5 din consecutive absent → delete

const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// HELPERS
// ============================================================

// ✅ Time compare: "10:00" <= current <= "10:45"
function isWithinWindow(startTime, endTime, now = new Date()) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const curMin = now.getHours() * 60 + now.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return curMin >= startMin && curMin <= endMin;
}

// ✅ Late check
function isLateArrival(lateAfter, now = new Date()) {
  if (!lateAfter) return false;
  const [lh, lm] = lateAfter.split(":").map(Number);
  const curMin = now.getHours() * 60 + now.getMinutes();
  return curMin > lh * 60 + lm;
}

// ✅ Today's day: "Mon"
function todayDay() {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
}

// ✅ Date string: "2026-01-15"
function todayDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ✅ Time string: "10:23:45"
function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ✅ QR token generate (HMAC signed - forge proof)
function generateQRToken(studentCode) {
  const random = crypto.randomBytes(8).toString("hex");
  const payload = `${studentCode}:${random}`;
  const hmac = crypto.createHmac("sha256", QR_SECRET)
    .update(payload).digest("hex").slice(0, 16);
  return `GSSS:${payload}:${hmac}`;
}

// ✅ QR verify
function verifyQRToken(token) {
  if (!token || !token.startsWith("GSSS:")) return null;
  const parts = token.split(":");
  if (parts.length !== 4) return null;
  const [, studentCode, random, hmac] = parts;
  const expected = crypto.createHmac("sha256", QR_SECRET)
    .update(`${studentCode}:${random}`).digest("hex").slice(0, 16);
  if (hmac !== expected) return null;
  return { studentCode };
}

// ============================================================
// MIDDLEWARE - AUTH
// ============================================================
function authAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ success: false, message: "No token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid/expired token" });
  }
}

function authTeacher(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ success: false, message: "No token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "teacher") {
      return res.status(403).json({ success: false, message: "Teacher only" });
    }
    req.teacher = decoded;
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: "Invalid/expired token" });
  }
}

// ============================================================
// AUTO-DELETE ABSENT STUDENTS (5 din rule)
// ═══════════════════════════════════════════════════════════
async function autoDeleteAbsentStudents() {
  try {
    // Jin students ne 5+ din consecutive absent hai
    const flagged = await q(
      `SELECT sat.student_id, sat.consecutive_absent_days, n.name, n.student_id AS code, n.class
       FROM student_absence_tracker sat
       JOIN Nstudent n ON n.id = sat.student_id
       WHERE sat.consecutive_absent_days >= ?
         AND sat.auto_deleted = 0
         AND n.status = 'Active'`,
      [ABSENT_AUTO_DELETE_DAYS]
    );

    let deletedCount = 0;
    for (const s of flagged) {
      // Mark student as deleted (soft delete)
      await q(
        `UPDATE Nstudent SET status = 'Auto-Deleted',
         promoted_from = COALESCE(promoted_from, ''),
         promotion_date = NOW()
         WHERE id = ?`,
        [s.student_id]
      );

      await q(
        `UPDATE student_absence_tracker 
         SET auto_deleted = 1, deleted_at = NOW(), is_flagged = 1, flagged_at = NOW()
         WHERE student_id = ?`,
        [s.student_id]
      );

      console.log(`🗑️ Auto-deleted: ${s.name} (${s.code}) - ${s.consecutive_absent_days} days absent`);
      deletedCount++;
    }

    return deletedCount;
  } catch (err) {
    console.error("Auto-delete error:", err.message);
    return 0;
  }
}

// Timer - every 6 hours
setInterval(autoDeleteAbsentStudents, 6 * 60 * 60 * 1000);
setTimeout(autoDeleteAbsentStudents, 30 * 1000); // startup pe bhi

// ============================================================
// ═══════════════ TEACHER AUTH ROUTES ════════════════════════
// ============================================================

// 1. TEACHER LOGIN
router.post("/teacher/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email & password required" });
    }

    const rows = await q(
      "SELECT * FROM teachers WHERE email = ? AND is_active = 1",
      [email.toLowerCase().trim()]
    );
    if (!rows.length) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const teacher = rows[0];
    const ok = await bcrypt.compare(password, teacher.password);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign(
      { id: teacher.id, role: "teacher", name: teacher.name, email: teacher.email },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    // Aaj ke assignments
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

// 2. TEACHER - AJ KE ASSIGNMENTS
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

    // Har assignment ke liye aaj ka attendance count
    const enriched = await Promise.all(assignments.map(async (a) => {
      const marked = await q(
        `SELECT COUNT(*) AS cnt FROM attendance
         WHERE teacher_id = ? AND class = ? AND period = ? AND date_str = ?`,
        [req.teacher.id, a.class, a.period, dateStr]
      );

      const total = await q(
        `SELECT COUNT(*) AS cnt FROM Nstudent
         WHERE class = ? AND status = 'Active'`,
        [a.class]
      );

      const now = new Date();
      const inWindow = isWithinWindow(a.start_time, a.end_time, now);

      return {
        ...a,
        markedCount: marked[0]?.cnt || 0,
        totalStudents: total[0]?.cnt || 0,
        isLive: inWindow,
        canScan: inWindow,
        currentTime: nowTimeStr()
      };
    }));

    res.json({
      success: true,
      day,
      date: dateStr,
      currentTime: nowTimeStr(),
      data: enriched
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ═══════════════ ATTENDANCE SCAN (CORE) ═════════════════════
// ============================================================

// 3. SCAN QR → MARK ATTENDANCE
router.post("/scan", authTeacher, async (req, res) => {
  try {
    const { qrToken, class: cls, subjectId, period } = req.body;

    if (!qrToken || !cls || !subjectId || !period) {
      return res.status(400).json({ success: false, message: "qrToken, class, subjectId, period required" });
    }

    // ── STEP 1: QR verify ───────────────────────────
    const verified = verifyQRToken(qrToken);
    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "❌ Invalid QR code. Ye GSSS Shilla ka QR nahi hai.",
        code: "INVALID_QR"
      });
    }

    // ── STEP 2: Student find from Nstudent ──────────
    const studentRows = await q(
      `SELECT * FROM Nstudent 
       WHERE student_id = ? AND status = 'Active' LIMIT 1`,
      [verified.studentCode]
    );
    if (!studentRows.length) {
      return res.status(404).json({
        success: false,
        message: "❌ Student Nstudent table me nahi mila ya inactive hai",
        code: "STUDENT_NOT_FOUND"
      });
    }
    const student = studentRows[0];

    // ── STEP 3: Assignment verify (teacher assigned hai?) ──
    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, period]
    );
    if (!assignRows.length) {
      return res.status(403).json({
        success: false,
        message: "❌ Aap is class/subject/period ke liye assigned nahi ho",
        code: "NOT_ASSIGNED"
      });
    }
    const assignment = assignRows[0];

    // ── STEP 4: TIME WINDOW check ───────────────────
    const now = new Date();
    if (!isWithinWindow(assignment.start_time, assignment.end_time, now)) {
      return res.status(400).json({
        success: false,
        message: `⏰ Attendance time window nahi hai. Window: ${assignment.start_time} - ${assignment.end_time}. Abhi: ${nowTimeStr()}`,
        code: "OUTSIDE_WINDOW",
        window: { start: assignment.start_time, end: assignment.end_time },
        currentTime: nowTimeStr()
      });
    }

    // ── STEP 5: Student class match ─────────────────
    if (String(student.class) !== String(cls)) {
      return res.status(400).json({
        success: false,
        message: `❌ Ye student Class ${student.class} ka hai, Class ${cls} me nahi`,
        code: "CLASS_MISMATCH"
      });
    }

    // ── STEP 6: Duplicate check ─────────────────────
    const dateStr = todayDateStr();
    const existing = await q(
      `SELECT * FROM attendance 
       WHERE student_id = ? AND date_str = ? AND period = ? LIMIT 1`,
      [student.id, dateStr, period]
    );
    if (existing.length) {
      return res.json({
        success: true,
        alreadyMarked: true,
        message: `⚠️ ${student.name} ki attendance already marked hai (${existing[0].marked_time})`,
        student: formatStudent(student),
        attendance: existing[0]
      });
    }

    // ── STEP 7: Late check ──────────────────────────
    const late = assignment.late_after ? isLateArrival(assignment.late_after, now) : false;
    const status = late ? "late" : "present";
    const timeStr = nowTimeStr();

    // ── STEP 8: Subject name ────────────────────────
    const subRows = await q(`SELECT name FROM subjects WHERE id = ?`, [subjectId]);
    const subjectName = subRows[0]?.name || "";

    // ── STEP 9: Insert attendance ───────────────────
    const result = await q(
      `INSERT INTO attendance 
        (student_id, student_code, student_name, roll_number, class, section,
         subject_id, subject_name, teacher_id, teacher_name,
         period, date, date_str, marked_at, marked_time,
         window_start, window_end, status, is_late, method, device_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, NOW(), ?, ?, ?, ?, ?, 'qr', ?)`,
      [
        student.id, student.student_id, student.name, student.roll_number,
        cls, student.section || null,
        subjectId, subjectName, req.teacher.id, req.teacher.name,
        period, dateStr, timeStr,
        assignment.start_time, assignment.end_time,
        status, late ? 1 : 0,
        (req.headers["user-agent"] || "").slice(0, 250)
      ]
    );

    // ── STEP 10: Absence tracker reset ──────────────
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
        period,
        class: cls,
        subject: subjectName,
        markedAt: now.toISOString(),
        markedTime: timeStr
      }
    });
  } catch (err) {
    console.error("❌ Scan error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. LIVE ATTENDANCE (aaj ka scan hua list)
router.get("/live/:class/:subjectId/:period", authTeacher, async (req, res) => {
  try {
    const { class: cls, subjectId, period } = req.params;
    const dateStr = todayDateStr();

    const records = await q(
      `SELECT * FROM attendance
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND date_str = ?
       ORDER BY marked_at ASC`,
      [req.teacher.id, cls, subjectId, period, dateStr]
    );

    // Class ke saare active students
    const allStudents = await q(
      `SELECT id, student_id, name, roll_number, section, student_photo_url
       FROM Nstudent WHERE class = ? AND status = 'Active'
       ORDER BY CAST(roll_number AS UNSIGNED), name`,
      [cls]
    );

    // Absent list
    const presentIds = records.map(r => r.student_id);
    const absentStudents = allStudents.filter(s => !presentIds.includes(s.id));

    res.json({
      success: true,
      date: dateStr,
      currentTime: nowTimeStr(),
      data: records,
      absent: absentStudents.map(s => ({
        id: s.id, student_id: s.student_id, name: s.name,
        roll_number: s.roll_number, section: s.section,
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
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. MANUAL MARK (QR fail)
router.post("/manual", authTeacher, async (req, res) => {
  try {
    const { studentId, class: cls, subjectId, period, status = "present" } = req.body;

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, period]
    );
    if (!assignRows.length) {
      return res.status(403).json({ success: false, message: "Not assigned to this class/period" });
    }
    const assignment = assignRows[0];

    const now = new Date();
    if (!isWithinWindow(assignment.start_time, assignment.end_time, now)) {
      return res.status(400).json({
        success: false,
        message: `⏰ Window bahar. Window: ${assignment.start_time} - ${assignment.end_time}`
      });
    }

    const studentRows = await q(
      `SELECT * FROM Nstudent WHERE id = ? AND class = ? AND status = 'Active' LIMIT 1`,
      [studentId, cls]
    );
    if (!studentRows.length) {
      return res.status(404).json({ success: false, message: "Student not found in this class" });
    }
    const student = studentRows[0];
    const dateStr = todayDateStr();
    const timeStr = nowTimeStr();
    const subRows = await q(`SELECT name FROM subjects WHERE id = ?`, [subjectId]);

    const result = await q(
      `INSERT INTO attendance
        (student_id, student_code, student_name, roll_number, class, section,
         subject_id, subject_name, teacher_id, teacher_name,
         period, date, date_str, marked_at, marked_time,
         window_start, window_end, status, is_late, method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, NOW(), ?, ?, ?, ?, 0, 'manual')
       ON DUPLICATE KEY UPDATE status = VALUES(status), method = 'manual'`,
      [
        student.id, student.student_id, student.name, student.roll_number,
        cls, student.section || null,
        subjectId, subRows[0]?.name || "", req.teacher.id, req.teacher.name,
        period, dateStr, timeStr,
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
      message: `✅ ${student.name} manually marked ${status}`,
      student: formatStudent(student)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. FINALIZE (absent mark karo jo scan nahi hue)
router.post("/finalize", authTeacher, async (req, res) => {
  try {
    const { class: cls, subjectId, period } = req.body;

    const assignRows = await q(
      `SELECT * FROM assignments 
       WHERE teacher_id = ? AND class = ? AND subject_id = ? 
         AND period = ? AND is_active = 1 LIMIT 1`,
      [req.teacher.id, cls, subjectId, period]
    );
    if (!assignRows.length) {
      return res.status(403).json({ success: false, message: "Not assigned" });
    }
    const assignment = assignRows[0];

    const dateStr = todayDateStr();
    const timeStr = nowTimeStr();

    // Aaj class ke saare students
    const allStudents = await q(
      `SELECT id, student_id, name, roll_number, section
       FROM Nstudent WHERE class = ? AND status = 'Active'`,
      [cls]
    );

    // Jo scan ho chuke
    const marked = await q(
      `SELECT student_id FROM attendance
       WHERE class = ? AND period = ? AND date_str = ?`,
      [cls, period, dateStr]
    );
    const markedIds = marked.map(m => m.student_id);

    // Absent students
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
            s.id, s.student_id, s.name, s.roll_number,
            cls, s.section || null,
            subjectId, subjectName, req.teacher.id, req.teacher.name,
            period, dateStr, timeStr,
            assignment.start_time, assignment.end_time
          ]
        );
        inserted++;

        // ✅ Absence tracker increment
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
      } catch (e) {
        // Duplicate ignore
      }
    }

    res.json({
      success: true,
      message: `✅ Attendance finalized. ${inserted} students marked absent`,
      absentCount: inserted,
      date: dateStr,
      time: timeStr
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ═══════════════ ADMIN - TEACHER MANAGEMENT ═════════════════
// ============================================================

// 7. CREATE TEACHER (Admin)
router.post("/admin/teachers", authAdmin, async (req, res) => {
  try {
    const { teacher_id, name, email, phone, password, photo_url, photo_pid } = req.body;

    if (!teacher_id || !name || !email || !password) {
      return res.status(400).json({ success: false, message: "teacher_id, name, email, password required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password min 6 chars" });
    }

    const dup = await q(
      `SELECT id FROM teachers WHERE email = ? OR teacher_id = ?`,
      [email.toLowerCase().trim(), teacher_id]
    );
    if (dup.length) {
      return res.status(400).json({ success: false, message: "Email or Teacher ID already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await q(
      `INSERT INTO teachers (teacher_id, name, email, phone, password, photo_url, photo_pid, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [teacher_id, name, email.toLowerCase().trim(), phone || null, hashed, photo_url || null, photo_pid || null]
    );

    const teacher = (await q(`SELECT id, teacher_id, name, email, phone, photo_url, is_active, created_at FROM teachers WHERE id = ?`, [result.insertId]))[0];

    res.status(201).json({
      success: true,
      message: `✅ Teacher ${name} created`,
      data: teacher
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. LIST ALL TEACHERS
router.get("/admin/teachers", authAdmin, async (req, res) => {
  try {
    const teachers = await q(
      `SELECT id, teacher_id, name, email, phone, photo_url, is_active, created_at
       FROM teachers ORDER BY name ASC`
    );

    // Har teacher ke assignments
    const withAssignments = await Promise.all(teachers.map(async (t) => {
      const assignments = await q(
        `SELECT a.*, s.name AS subject_name, s.code AS subject_code
         FROM assignments a
         JOIN subjects s ON s.id = a.subject_id
         WHERE a.teacher_id = ? AND a.is_active = 1
         ORDER BY a.class, a.period`,
        [t.id]
      );
      return { ...t, assignments };
    }));

    res.json({ success: true, data: withAssignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9. GET SINGLE TEACHER
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

// 10. UPDATE TEACHER
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
      [name || null, email?.toLowerCase().trim() || null, phone || null, photo_url || null, photo_pid || null, req.params.id]
    );
    res.json({ success: true, message: "✅ Teacher updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 11. TOGGLE TEACHER ACTIVE
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

// 12. DELETE TEACHER (soft)
router.delete("/admin/teachers/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE teachers SET is_active = 0 WHERE id = ?`, [req.params.id]);
    await q(`UPDATE assignments SET is_active = 0 WHERE teacher_id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Teacher disabled" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 13. RESET PASSWORD
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

// ============================================================
// ═══════════════ ADMIN - ASSIGNMENTS ════════════════════════
// ============================================================

// 14. ASSIGN SUBJECT/CLASS/PERIOD/TIME TO TEACHER
router.post("/admin/teachers/:id/assign", authAdmin, async (req, res) => {
  try {
    const {
      subjectId, class: cls, section,
      period, days, startTime, endTime, lateAfter
    } = req.body;

    if (!subjectId || !cls || !period || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "subjectId, class, period, startTime, endTime required"
      });
    }

    // Time format validate
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ success: false, message: "Time format HH:MM required" });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ success: false, message: "startTime < endTime hona chahiye" });
    }

    // Teacher exists?
    const t = await q(`SELECT id, name FROM teachers WHERE id = ?`, [req.params.id]);
    if (!t.length) return res.status(404).json({ success: false, message: "Teacher not found" });

    // Subject exists?
    const sub = await q(`SELECT id, name FROM subjects WHERE id = ?`, [subjectId]);
    if (!sub.length) return res.status(404).json({ success: false, message: "Subject not found" });

    // Duplicate check
    const dup = await q(
      `SELECT id FROM assignments 
       WHERE teacher_id = ? AND subject_id = ? AND class = ? AND period = ? AND is_active = 1`,
      [req.params.id, subjectId, cls, period]
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
        req.params.id, subjectId, cls, section || null,
        period, daysStr, startTime, endTime, lateAfter || null
      ]
    );

    res.status(201).json({
      success: true,
      message: `✅ Assigned: Class ${cls} - ${sub[0].name} - Period ${period} (${startTime}-${endTime})`,
      data: {
        id: result.insertId,
        teacher_id: req.params.id,
        teacher_name: t[0].name,
        subject_id: subjectId,
        subject_name: sub[0].name,
        class: cls, section, period, days: daysStr,
        start_time: startTime, end_time: endTime, late_after: lateAfter
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 15. REMOVE ASSIGNMENT
router.delete("/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE assignments SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Assignment removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 16. UPDATE ASSIGNMENT (time change etc.)
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

// ============================================================
// ═══════════════ ADMIN - SUBJECTS ═══════════════════════════
// ============================================================

// 17. CREATE SUBJECT
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

// 18. LIST SUBJECTS (class-wise)
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

// 19. DELETE SUBJECT
router.delete("/admin/subjects/:id", authAdmin, async (req, res) => {
  try {
    await q(`UPDATE subjects SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: "✅ Subject removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ═══════════════ QR GENERATION FOR STUDENTS ═════════════════
// ============================================================

// 20. GENERATE / GET QR FOR STUDENT
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

    // Check existing QR
    let qrRows = await q(
      `SELECT * FROM student_qr WHERE student_id = ? AND is_active = 1 LIMIT 1`,
      [student.id]
    );

    let token;
    if (qrRows.length) {
      token = qrRows[0].qr_token;
    } else {
      // Generate new
      token = generateQRToken(student.student_id);
      await q(
        `INSERT INTO student_qr (student_id, student_code, qr_token, qr_secret, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [student.id, student.student_id, token, crypto.randomBytes(16).toString("hex")]
      );
    }

    // QR image as data URL
    const qrDataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: "H",
      width: 300,
      margin: 1,
      color: { dark: "#1a2332", light: "#ffffff" }
    });

    res.json({
      success: true,
      data: {
        student_id: student.student_id,
        student_name: student.name,
        class: student.class,
        qr_token: token,
        qr_image: qrDataUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 21. BULK GENERATE QR FOR CLASS
router.post("/qr/generate-class/:class", authAdmin, async (req, res) => {
  try {
    const { class: cls } = req.params;
    const students = await q(
      `SELECT id, student_id, name FROM Nstudent 
       WHERE class = ? AND status = 'Active'`,
      [cls]
    );

    let generated = 0, existing = 0;
    for (const s of students) {
      const ex = await q(
        `SELECT id FROM student_qr WHERE student_id = ? AND is_active = 1`,
        [s.id]
      );
      if (ex.length) { existing++; continue; }

      const token = generateQRToken(s.student_id);
      await q(
        `INSERT INTO student_qr (student_id, student_code, qr_token, qr_secret, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [s.id, s.student_id, token, crypto.randomBytes(16).toString("hex")]
      );
      generated++;
    }

    res.json({
      success: true,
      message: `✅ ${generated} new QR generated, ${existing} already existed`,
      total: students.length,
      generated, existing
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ═══════════════ REPORTS ════════════════════════════════════
// ============================================================

// 22. STUDENT ATTENDANCE REPORT
router.get("/reports/student/:studentCode", authAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const { studentCode } = req.params;

    const studentRows = await q(
      `SELECT id, name, class, roll_number FROM Nstudent WHERE student_id = ?`,
      [studentCode]
    );
    if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found" });
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

// 23. CLASS ATTENDANCE REPORT
router.get("/reports/class/:class", authAdmin, async (req, res) => {
  try {
    const { date, period, subjectId } = req.query;
    const { class: cls } = req.params;

    let sql = `SELECT * FROM attendance WHERE class = ?`;
    const params = [cls];
    if (date) { sql += ` AND date_str = ?`; params.push(date); }
    if (period) { sql += ` AND period = ?`; params.push(period); }
    if (subjectId) { sql += ` AND subject_id = ?`; params.push(subjectId); }
    sql += ` ORDER BY date DESC, period ASC`;

    const records = await q(sql, params);
    res.json({ success: true, data: records, count: records.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 24. ATTENDANCE STATS (dashboard)
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

    // Class-wise today
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

// 25. AT-RISK STUDENTS (5 din absent)
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

// 26. MANUAL AUTO-DELETE TRIGGER (admin button)
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

// 27. RECOVER AUTO-DELETED STUDENT
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

// ============================================================
// HELPER
// ============================================================
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

module.exports = router;
