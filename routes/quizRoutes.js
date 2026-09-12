const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const q = (sql, params = []) => db.query(sql, params);

// ============================================================
// AUTH
// ============================================================
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization || "";
  const tokenQuery = req.query.token || "";
  let token = "";
  if (auth.startsWith("Bearer ")) token = auth.substring(7);
  else if (tokenQuery) token = tokenQuery;
  if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });
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
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
};

const generateCertCode = (attemptId, studentId) => {
  const raw = `CERT-${attemptId}-${studentId}-${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  return `GSSS-QZ-${Math.abs(hash).toString(36).toUpperCase().substring(0, 10)}`;
};

// ============================================================
// AUTO-START / AUTO-END ENGINE
// ============================================================
setInterval(async () => {
  try {
    const toStart = await q(
      `SELECT * FROM quiz_events 
       WHERE status = 'Scheduled' 
         AND scheduled_start IS NOT NULL 
         AND scheduled_start <= NOW()
         AND is_active = 1`
    );
    for (const evt of toStart) {
      const qCount = await q("SELECT COUNT(*) as c FROM quiz_questions WHERE event_id = ?", [evt.id]);
      if (qCount[0].c >= 1) {
        await q("UPDATE quiz_events SET status = 'Live', started_at = NOW() WHERE id = ?", [evt.id]);
        console.log(`🟢 Auto-started quiz #${evt.id}`);
      }
    }
    const toEnd = await q(
      `SELECT * FROM quiz_events 
       WHERE status = 'Live' 
         AND scheduled_end IS NOT NULL 
         AND scheduled_end <= NOW()`
    );
    for (const evt of toEnd) {
      await q("UPDATE quiz_events SET status = 'Ended', ended_at = NOW() WHERE id = ?", [evt.id]);
      await q(
        `UPDATE quiz_attempts SET status = 'AutoSubmitted', submitted_at = NOW()
         WHERE event_id = ? AND status = 'InProgress'`,
        [evt.id]
      );
      console.log(`🔴 Auto-ended quiz #${evt.id}`);
    }
  } catch (err) {}
}, 30000);

// ============================================================
// ADMIN — CREATE EVENT
// ============================================================
router.post("/events", requireAdmin, async (req, res) => {
  try {
    const {
      title, description, class: cls, stream, groupNames, language,
      durationMinutes, totalQuestions, passPercentage,
      scheduledStart, scheduledEnd,
      randomizeQuestions, showResultImmediately
    } = req.body;

    if (!title || !cls) return res.status(400).json({ success: false, message: "Title and class required" });
    if (!durationMinutes || durationMinutes < 1) return res.status(400).json({ success: false, message: "Duration required" });
    if (!totalQuestions || totalQuestions < 3) return res.status(400).json({ success: false, message: "At least 3 questions required" });

    const streamVal = ["11","12"].includes(String(cls)) ? (stream || "Non-Specialized") : "Non-Specialized";

    let status = "Draft";
    if (scheduledStart) {
      const startTime = new Date(scheduledStart);
      if (startTime <= new Date()) status = "Live";
      else status = "Scheduled";
    }

    const result = await q(
      `INSERT INTO quiz_events 
        (title, description, class, stream, group_names, language, duration_minutes, 
         total_questions, total_marks, pass_percentage, status,
         scheduled_start, scheduled_end, randomize_questions, show_result_immediately)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, description || null, cls, streamVal, groupNames || null, language || "English",
        parseInt(durationMinutes), parseInt(totalQuestions), parseInt(totalQuestions),
        parseInt(passPercentage) || 40, status,
        scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd ? new Date(scheduledEnd) : null,
        randomizeQuestions !== false ? 1 : 0,
        showResultImmediately !== false ? 1 : 0
      ]
    );

    if (status === "Live") {
      await q("UPDATE quiz_events SET started_at = NOW() WHERE id = ?", [result.insertId]);
    }

    const rows = await q("SELECT * FROM quiz_events WHERE id = ?", [result.insertId]);
    res.status(201).json({ success: true, message: "Quiz event created ✅", data: rows[0] });
  } catch (err) {
    console.error("❌ create event error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — LIST EVENTS
// ============================================================
router.get("/events", requireAdmin, async (req, res) => {
  try {
    const { class: cls, status } = req.query;
    const where = [];
    const params = [];
    if (cls) { where.push("class = ?"); params.push(cls); }
    if (status) { where.push("status = ?"); params.push(status); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await q(
      `SELECT e.*, 
        (SELECT COUNT(*) FROM quiz_questions WHERE event_id = e.id) as questions_count,
        (SELECT COUNT(*) FROM quiz_attempts WHERE event_id = e.id AND status IN ('Submitted','AutoSubmitted')) as attempts_count,
        (SELECT COUNT(*) FROM quiz_attempts WHERE event_id = e.id AND status = 'InProgress') as in_progress_count
       FROM quiz_events e ${whereSql}
       ORDER BY 
         CASE e.status WHEN 'Live' THEN 1 WHEN 'Scheduled' THEN 2 WHEN 'Draft' THEN 3 ELSE 4 END,
         e.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — GET SINGLE
// ============================================================
router.get("/events/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await q("SELECT * FROM quiz_events WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Event not found" });
    const questions = await q(
      "SELECT * FROM quiz_questions WHERE event_id = ? ORDER BY question_no ASC",
      [id]
    );
    res.json({ success: true, data: rows[0], questions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — SAVE QUESTIONS
// ============================================================
router.post("/events/:id/questions", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { questions } = req.body;
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ success: false, message: "Questions array required" });
    }
    const eventRows = await q("SELECT * FROM quiz_events WHERE id = ?", [id]);
    if (!eventRows.length) return res.status(404).json({ success: false, message: "Event not found" });

    await q("DELETE FROM quiz_questions WHERE event_id = ?", [id]);

    let inserted = 0;
    for (let i = 0; i < questions.length; i++) {
      const qq = questions[i];
      await q(
        `INSERT INTO quiz_questions 
          (event_id, question_no, question_en, question_hi, 
           option_a_en, option_b_en, option_c_en, option_d_en,
           option_a_hi, option_b_hi, option_c_hi, option_d_hi,
           correct_answer, marks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, i + 1,
          qq.questionEn || "", qq.questionHi || null,
          qq.optionAEn || "", qq.optionBEn || "", qq.optionCEn || "", qq.optionDEn || "",
          qq.optionAHi || null, qq.optionBHi || null, qq.optionCHi || null, qq.optionDHi || null,
          qq.correctAnswer || "A", qq.marks || 1
        ]
      );
      inserted++;
    }
    await q("UPDATE quiz_events SET total_questions = ?, total_marks = ? WHERE id = ?", [inserted, inserted, id]);
    res.json({ success: true, message: `${inserted} questions saved ✅`, count: inserted });
  } catch (err) {
    console.error("❌ save questions error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — UPDATE
// ============================================================
router.put("/events/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, durationMinutes, status,
      scheduledStart, scheduledEnd, passPercentage,
      randomizeQuestions, showResultImmediately
    } = req.body;
    const rows = await q("SELECT * FROM quiz_events WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Event not found" });
    const e = rows[0];

    await q(
      `UPDATE quiz_events SET 
        title = ?, description = ?, duration_minutes = ?, status = ?, 
        scheduled_start = ?, scheduled_end = ?, pass_percentage = ?, 
        randomize_questions = ?, show_result_immediately = ?
       WHERE id = ?`,
      [
        title || e.title,
        description !== undefined ? description : e.description,
        durationMinutes || e.duration_minutes,
        status || e.status,
        scheduledStart !== undefined ? (scheduledStart ? new Date(scheduledStart) : null) : e.scheduled_start,
        scheduledEnd !== undefined ? (scheduledEnd ? new Date(scheduledEnd) : null) : e.scheduled_end,
        passPercentage || e.pass_percentage,
        randomizeQuestions !== undefined ? (randomizeQuestions ? 1 : 0) : e.randomize_questions,
        showResultImmediately !== undefined ? (showResultImmediately ? 1 : 0) : e.show_result_immediately,
        id
      ]
    );
    const updated = await q("SELECT * FROM quiz_events WHERE id = ?", [id]);
    res.json({ success: true, message: "Event updated ✅", data: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — GO LIVE
// ============================================================
router.post("/events/:id/go-live", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await q("SELECT * FROM quiz_events WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: "Event not found" });
    const qCount = await q("SELECT COUNT(*) as c FROM quiz_questions WHERE event_id = ?", [id]);
    if (!qCount[0].c) return res.status(400).json({ success: false, message: "Add questions first" });
    await q("UPDATE quiz_events SET status = 'Live', started_at = NOW() WHERE id = ?", [id]);
    res.json({ success: true, message: "Quiz is now LIVE ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — END
// ============================================================
router.post("/events/:id/end", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await q("UPDATE quiz_events SET status = 'Ended', ended_at = NOW() WHERE id = ?", [id]);
    await q(
      `UPDATE quiz_attempts SET status = 'AutoSubmitted', submitted_at = NOW() 
       WHERE event_id = ? AND status = 'InProgress'`,
      [id]
    );
    res.json({ success: true, message: "Quiz ended ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — RESET
// ============================================================
router.post("/events/:id/reset", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await q("DELETE FROM quiz_answers WHERE event_id = ?", [id]);
    await q("DELETE FROM quiz_attempts WHERE event_id = ?", [id]);
    await q("UPDATE quiz_events SET status = 'Draft', started_at = NULL, ended_at = NULL WHERE id = ?", [id]);
    res.json({ success: true, message: "Event reset ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — DELETE
// ============================================================
router.delete("/events/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await q("DELETE FROM quiz_answers WHERE event_id = ?", [id]);
    await q("DELETE FROM quiz_attempts WHERE event_id = ?", [id]);
    await q("DELETE FROM quiz_questions WHERE event_id = ?", [id]);
    await q("DELETE FROM quiz_events WHERE id = ?", [id]);
    res.json({ success: true, message: "Event deleted ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — ATTEMPTS
// ============================================================
router.get("/events/:id/attempts", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await q(
      `SELECT * FROM quiz_attempts WHERE event_id = ? 
       ORDER BY marks_obtained DESC, time_taken_seconds ASC`,
      [id]
    );
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — Available
// ============================================================
router.post("/student/available", async (req, res) => {
  try {
    const { studentId, studentClass, email } = req.body;
    if (!studentId || !studentClass) {
      return res.status(400).json({ success: false, message: "Student ID and class required" });
    }
    const student = await q(
      "SELECT * FROM Nstudent WHERE student_id = ? AND class = ?",
      [studentId, studentClass]
    );
    if (!student.length) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }
    if (email && student[0].email_id && student[0].email_id.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ success: false, message: "Email does not match our records" });
    }

    const events = await q(
      `SELECT e.*, 
        (SELECT COUNT(*) FROM quiz_attempts WHERE event_id = e.id AND student_id = ?) as my_attempt_count,
        (SELECT status FROM quiz_attempts WHERE event_id = e.id AND student_id = ? LIMIT 1) as my_status,
        (SELECT marks_obtained FROM quiz_attempts WHERE event_id = e.id AND student_id = ? LIMIT 1) as my_marks,
        (SELECT total_marks FROM quiz_attempts WHERE event_id = e.id AND student_id = ? LIMIT 1) as my_total_marks,
        (SELECT id FROM quiz_attempts WHERE event_id = e.id AND student_id = ? LIMIT 1) as my_attempt_id
       FROM quiz_events e
       WHERE e.is_active = 1 
         AND (e.class = ? OR e.class = 'All')
         AND e.status IN ('Live','Scheduled','Ended')
       ORDER BY 
         CASE e.status WHEN 'Live' THEN 1 WHEN 'Scheduled' THEN 2 ELSE 3 END,
         e.created_at DESC`,
      [studentId, studentId, studentId, studentId, studentId, studentClass]
    );

    res.json({
      success: true,
      student: {
        student_id: student[0].student_id,
        name: student[0].name,
        class: student[0].class,
        stream: student[0].stream,
        email: student[0].email_id,
        photo: student[0].student_photo_url
      },
      events: events.map(e => ({
        ...e,
        can_attempt: e.status === "Live" && !e.my_attempt_count,
        already_attempted: e.my_attempt_count > 0
      }))
    });
  } catch (err) {
    console.error("❌ available error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — Start
// ============================================================
router.post("/student/start/:eventId", async (req, res) => {
  try {
    const { eventId } = req.params;
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: "Student ID required" });

    const eventRows = await q("SELECT * FROM quiz_events WHERE id = ?", [eventId]);
    if (!eventRows.length) return res.status(404).json({ success: false, message: "Quiz not found" });
    const event = eventRows[0];

    if (event.status !== "Live") {
      return res.status(400).json({ success: false, message: "Quiz is not live right now" });
    }
    if (event.scheduled_end && new Date() > new Date(event.scheduled_end)) {
      return res.status(400).json({ success: false, message: "Quiz time has expired" });
    }

    const existing = await q(
      "SELECT * FROM quiz_attempts WHERE event_id = ? AND student_id = ?",
      [eventId, studentId]
    );
    if (existing.length && existing[0].status !== "InProgress") {
      return res.status(400).json({ success: false, message: "You have already attempted this quiz" });
    }

    const students = await q("SELECT * FROM Nstudent WHERE student_id = ?", [studentId]);
    if (!students.length) return res.status(404).json({ success: false, message: "Student not found" });
    const s = students[0];

    if (String(s.class) !== String(event.class) && event.class !== "All") {
      return res.status(403).json({ success: false, message: "This quiz is not for your class" });
    }

    let attemptId;
    if (existing.length) {
      attemptId = existing[0].id;
    } else {
      const result = await q(
        `INSERT INTO quiz_attempts 
          (event_id, student_id, student_name, student_class, student_email, 
           started_at, total_questions, total_marks, status)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, 'InProgress')`,
        [eventId, studentId, s.name, s.class, s.email_id, event.total_questions, event.total_marks]
      );
      attemptId = result.insertId;
    }

    let questions = await q(
      "SELECT id, question_no, question_en, question_hi, option_a_en, option_b_en, option_c_en, option_d_en, option_a_hi, option_b_hi, option_c_hi, option_d_hi, marks FROM quiz_questions WHERE event_id = ? ORDER BY question_no ASC",
      [eventId]
    );
    if (event.randomize_questions) {
      questions = questions.sort(() => Math.random() - 0.5);
    }

    const answered = await q(
      "SELECT question_id, selected_answer FROM quiz_answers WHERE attempt_id = ?",
      [attemptId]
    );

    const startedAt = new Date(existing.length ? existing[0].started_at : new Date());
    const elapsedSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    const durationSeconds = event.duration_minutes * 60;
    const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);

    res.json({
      success: true,
      attempt_id: attemptId,
      remaining_seconds: remainingSeconds,
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        duration_minutes: event.duration_minutes,
        total_questions: questions.length,
        total_marks: event.total_marks,
        language: event.language,
        pass_percentage: event.pass_percentage
      },
      student: { name: s.name, student_id: s.student_id, class: s.class },
      questions,
      answered
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — Answer
// ============================================================
router.post("/student/answer", async (req, res) => {
  try {
    const { attemptId, questionId, selectedAnswer } = req.body;
    if (!attemptId || !questionId) {
      return res.status(400).json({ success: false, message: "attemptId and questionId required" });
    }

    const attempts = await q("SELECT * FROM quiz_attempts WHERE id = ?", [attemptId]);
    if (!attempts.length) return res.status(404).json({ success: false, message: "Attempt not found" });
    if (attempts[0].status !== "InProgress") {
      return res.status(400).json({ success: false, message: "Attempt already submitted" });
    }

    const eventRows = await q("SELECT * FROM quiz_events WHERE id = ?", [attempts[0].event_id]);
    const event = eventRows[0];

    const startedAt = new Date(attempts[0].started_at);
    const elapsed = (Date.now() - startedAt.getTime()) / 1000;
    if (elapsed > event.duration_minutes * 60) {
      return res.status(400).json({ success: false, message: "Time limit exceeded" });
    }

    const questions = await q("SELECT * FROM quiz_questions WHERE id = ?", [questionId]);
    if (!questions.length) return res.status(404).json({ success: false, message: "Question not found" });
    const question = questions[0];

    const isCorrect = selectedAnswer && question.correct_answer === selectedAnswer ? 1 : 0;
    const marksAwarded = isCorrect ? question.marks : 0;

    const existing = await q(
      "SELECT * FROM quiz_answers WHERE attempt_id = ? AND question_id = ?",
      [attemptId, questionId]
    );

    if (existing.length) {
      await q(
        `UPDATE quiz_answers SET selected_answer = ?, is_correct = ?, marks_awarded = ?, answered_at = NOW() 
         WHERE id = ?`,
        [selectedAnswer || null, isCorrect, marksAwarded, existing[0].id]
      );
    } else {
      await q(
        `INSERT INTO quiz_answers (attempt_id, event_id, question_id, selected_answer, is_correct, marks_awarded)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [attemptId, attempts[0].event_id, questionId, selectedAnswer || null, isCorrect, marksAwarded]
      );
    }
    res.json({ success: true, saved: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — Submit
// ============================================================
router.post("/student/submit/:attemptId", async (req, res) => {
  try {
    const { attemptId } = req.params;
    const attempts = await q("SELECT * FROM quiz_attempts WHERE id = ?", [attemptId]);
    if (!attempts.length) return res.status(404).json({ success: false, message: "Attempt not found" });
    if (attempts[0].status !== "InProgress") {
      return res.status(400).json({ success: false, message: "Already submitted" });
    }
    const attempt = attempts[0];
    const eventRows = await q("SELECT * FROM quiz_events WHERE id = ?", [attempt.event_id]);
    const event = eventRows[0];
    const answers = await q("SELECT * FROM quiz_answers WHERE attempt_id = ?", [attemptId]);

    const totalQuestions = event.total_questions;
    let correct = 0, wrong = 0, unanswered = 0, marksObtained = 0;
    for (const ans of answers) {
      if (!ans.selected_answer) { unanswered++; continue; }
      if (ans.is_correct) { correct++; marksObtained += ans.marks_awarded; }
      else wrong++;
    }
    unanswered += (totalQuestions - answers.length);

    const percentage = totalQuestions > 0 ? (marksObtained / event.total_marks) * 100 : 0;
    const startedAt = new Date(attempt.started_at);
    const timeTaken = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    await q(
      `UPDATE quiz_attempts SET 
        submitted_at = NOW(), correct_answers = ?, wrong_answers = ?, unanswered = ?,
        marks_obtained = ?, percentage = ?, time_taken_seconds = ?, status = 'Submitted'
       WHERE id = ?`,
      [correct, wrong, unanswered, marksObtained, percentage.toFixed(2), timeTaken, attemptId]
    );

    const updated = await q("SELECT * FROM quiz_attempts WHERE id = ?", [attemptId]);
    res.json({ success: true, message: "Quiz submitted ✅", attempt: updated[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// CERTIFICATE PDF — Professional, QR, Watermark, Patterns
// ============================================================
router.get("/certificate/:attemptId/pdf", async (req, res) => {
  try {
    const { attemptId } = req.params;

    const attempts = await q("SELECT * FROM quiz_attempts WHERE id = ?", [attemptId]);
    if (!attempts.length) return res.status(404).json({ success: false, message: "Attempt not found" });
    const attempt = attempts[0];
    if (attempt.status === "InProgress") {
      return res.status(400).json({ success: false, message: "Please submit the quiz first" });
    }

    const events = await q("SELECT * FROM quiz_events WHERE id = ?", [attempt.event_id]);
    if (!events.length) return res.status(404).json({ success: false, message: "Event not found" });
    const event = events[0];

    // Certificate code
    const certCode = generateCertCode(attempt.id, attempt.student_id);

    // Determine pass/fail
    const passed = Number(attempt.percentage) >= Number(event.pass_percentage);
    const certTitle = passed ? "CERTIFICATE OF ACHIEVEMENT" : "CERTIFICATE OF PARTICIPATION";

    // Colour theme — gradient colours
    const themePrimary = passed ? "#0f766e" : "#7c2d12";     // Teal or Rust
    const themeAccent = passed ? "#10b981" : "#f59e0b";      // Emerald or Amber
    const themeDark = "#0d1b2a";
    const themeGold = "#c9972b";
    const themeLight = passed ? "#ecfdf5" : "#fffbeb";

    // Fetch assets
    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");

    // QR code with verification URL
    const verifyUrl = `https://gsssshilla07.pages.dev/verify-certificate.html?code=${encodeURIComponent(certCode)}&attempt=${attemptId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(verifyUrl)}&color=0d1b2a&bgcolor=ffffff`;
    const qrBuf = await fetchImageBuffer(qrUrl);

    // PDF — A4 Landscape
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="certificate-${certCode}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;   // ~841
    const PH = doc.page.height;  // ~595

    // ==================== BACKGROUND PATTERN ====================
    // Soft diagonal stripes (colourful)
    doc.save();
    for (let i = -PH; i < PW + PH; i += 40) {
      doc.moveTo(i, 0).lineTo(i + PH, PH).lineWidth(0.4).strokeColor(passed ? "#d1fae5" : "#fef3c7").stroke();
    }
    doc.restore();

    // Corner circle patterns (decorative)
    doc.save();
    doc.opacity(0.06);
    doc.circle(0, 0, 200).fill(themePrimary);
    doc.circle(PW, PH, 250).fill(themeAccent);
    doc.circle(PW, 0, 150).fill(themeGold);
    doc.circle(0, PH, 180).fill(themeAccent);
    doc.restore();

    // Small dots pattern
    doc.save();
    doc.opacity(0.08);
    for (let x = 0; x < PW; x += 25) {
      for (let y = 0; y < PH; y += 25) {
        if ((x + y) % 50 === 0) doc.circle(x, y, 0.8).fill(themePrimary);
      }
    }
    doc.restore();

    // ==================== LOGO WATERMARK (CENTER) ====================
    if (logoBuf) {
      doc.save();
      doc.opacity(0.06);
      try { doc.image(logoBuf, PW / 2 - 150, PH / 2 - 150, { width: 300, height: 300 }); } catch (e) {}
      doc.restore();
    }

    // Large text watermark
    doc.save();
    doc.opacity(0.035);
    doc.fontSize(110).font("Times-BoldItalic").fillColor(themePrimary);
    doc.rotate(-28, { origin: [PW / 2, PH / 2] });
    doc.text("GSSS SHILLA", PW / 2 - 380, PH / 2 - 60, { width: 760, align: "center" });
    doc.restore();

    // ==================== OUTER BORDERS ====================
    // Outer gradient border (multiple strokes for gradient effect)
    doc.rect(15, 15, PW - 30, PH - 30).lineWidth(6).strokeColor(themePrimary).stroke();
    doc.rect(22, 22, PW - 44, PH - 44).lineWidth(2).strokeColor(themeGold).stroke();
    doc.rect(28, 28, PW - 56, PH - 56).lineWidth(0.8).strokeColor(themeAccent).stroke();

    // Corner decorative squares
    const cornerSize = 20;
    [ [22, 22], [PW - 22 - cornerSize, 22], [22, PH - 22 - cornerSize], [PW - 22 - cornerSize, PH - 22 - cornerSize] ]
      .forEach(([x, y]) => {
        doc.rect(x, y, cornerSize, cornerSize).fill(themeAccent);
        doc.rect(x + 4, y + 4, cornerSize - 8, cornerSize - 8).fill(themeGold);
      });

    // ==================== HEADER ====================
    let y = 55;

    if (logoBuf) {
      try { doc.image(logoBuf, PW / 2 - 40, y, { width: 80, height: 80 }); } catch (e) {}
    }
    y += 90;

    doc.font("Times-Bold").fontSize(28).fillColor(themeDark)
      .text("GOVT. SR. SEC. SCHOOL SHILLA", 0, y, { width: PW, align: "center", characterSpacing: 1 });

    y += 34;
    doc.font("Times-Italic").fontSize(12).fillColor("#5a6a7e")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", 0, y, { width: PW, align: "center", characterSpacing: 2 });

    y += 20;
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8")
      .text("Affiliated to H.P. Board of School Education, Dharamshala", 0, y, { width: PW, align: "center", characterSpacing: 1 });

    // ==================== DIVIDER ====================
    y += 22;
    doc.moveTo(PW / 2 - 300, y).lineTo(PW / 2 + 300, y).lineWidth(2.5).strokeColor(themeGold).stroke();
    y += 5;
    doc.moveTo(PW / 2 - 300, y).lineTo(PW / 2 + 300, y).lineWidth(0.5).strokeColor(themeAccent).stroke();

    // ==================== TITLE (with gradient-ish effect) ====================
    y += 24;
    doc.font("Times-Bold").fontSize(34).fillColor(themePrimary)
      .text(certTitle, 0, y, { width: PW, align: "center", characterSpacing: 4 });

    y += 42;
    // Subtitle with serif italic
    doc.font("Times-Italic").fontSize(15).fillColor("#5a6a7e")
      .text("This is proudly presented to", 0, y, { width: PW, align: "center" });

    // ==================== STUDENT NAME ====================
    y += 30;
    doc.font("Times-BoldItalic").fontSize(42).fillColor(themeDark)
      .text((attempt.student_name || "").toUpperCase(), 0, y, { width: PW, align: "center", characterSpacing: 1 });

    // Gold underline
    y += 58;
    doc.moveTo(PW / 2 - 220, y).lineTo(PW / 2 + 220, y).lineWidth(1.5).strokeColor(themeGold).stroke();

    // ==================== CLASS INFO ====================
    y += 12;
    doc.font("Helvetica").fontSize(13).fillColor("#5a6a7e")
      .text(`Class ${attempt.student_class}  ·  Student ID: ${attempt.student_id}`, 0, y, { width: PW, align: "center", characterSpacing: 1 });

    // ==================== CERTIFICATION TEXT ====================
    y += 30;
    const certText = `for successfully participating in the "${event.title}" quiz event organized by Govt. Sr. Sec. School Shilla. The event was held on ${fmtDate(attempt.submitted_at || attempt.started_at)} and the participant scored ${attempt.marks_obtained} out of ${attempt.total_marks} marks (${attempt.percentage}%).`;

    doc.font("Times-Roman").fontSize(14).fillColor(themeDark)
      .text(certText, PW / 2 - 340, y, { width: 680, align: "center", lineGap: 6 });

    // ==================== SIGNATURE SECTION ====================
    const sigY = PH - 140;

    // Principal signature (only "Principal" text)
    if (principalBuf) {
      try { doc.image(principalBuf, PW / 2 + 130, sigY - 38, { width: 110, height: 55 }); } catch (e) {}
    }
    doc.moveTo(PW / 2 + 100, sigY + 22).lineTo(PW / 2 + 270, sigY + 22).lineWidth(1.5).strokeColor(themeDark).stroke();
    doc.font("Times-Bold").fontSize(14).fillColor(themeDark)
      .text("Principal", PW / 2 + 100, sigY + 30, { width: 170, align: "center" });

    // ==================== QR CODE (bottom-left) ====================
    const qrSize = 90;
    if (qrBuf) {
      doc.rect(60 - 3, sigY - 3, qrSize + 6, qrSize + 6).lineWidth(1.5).strokeColor(themeGold).stroke();
      try { doc.image(qrBuf, 60, sigY, { width: qrSize, height: qrSize }); } catch (e) {}
    }
    doc.font("Helvetica-Bold").fontSize(8).fillColor(themeDark)
      .text("SCAN TO VERIFY", 55, sigY + qrSize + 5, { width: qrSize + 10, align: "center", characterSpacing: 0.5 });

    // ==================== CERTIFICATE CODE (bottom-center) ====================
    doc.font("Courier-Bold").fontSize(11).fillColor(themePrimary)
      .text(certCode, 0, sigY + 25, { width: PW, align: "center", characterSpacing: 2 });
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text("Certificate ID", 0, sigY + 42, { width: PW, align: "center", characterSpacing: 1 });

    // ==================== FOOTER ====================
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#94a3b8")
      .text(`Issued on ${fmtDate(new Date())} • This is a computer-generated certificate issued by GSSS Shilla.`, 0, PH - 40, { width: PW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("❌ certificate PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});


// ============================================================
// PUBLIC — Verify by attempt ID
// ============================================================
router.get("/verify/attempt/:attemptId", async (req, res) => {
  try {
    const { attemptId } = req.params;

    const attempts = await q("SELECT * FROM quiz_attempts WHERE id = ?", [attemptId]);
    if (!attempts.length) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }
    const attempt = attempts[0];

    if (attempt.status === "InProgress") {
      return res.status(400).json({ success: false, message: "Certificate not yet issued" });
    }

    const events = await q("SELECT * FROM quiz_events WHERE id = ?", [attempt.event_id]);
    const event = events.length ? events[0] : {};

    const students = await q("SELECT student_id, name, class, father_name, mother_name, student_photo_url FROM Nstudent WHERE student_id = ?", [attempt.student_id]);
    const student = students.length ? students[0] : null;

    res.json({
      success: true,
      attempt: {
        id: attempt.id,
        student_id: attempt.student_id,
        student_name: attempt.student_name,
        student_class: attempt.student_class,
        marks_obtained: attempt.marks_obtained,
        total_marks: attempt.total_marks,
        percentage: attempt.percentage,
        correct_answers: attempt.correct_answers,
        wrong_answers: attempt.wrong_answers,
        submitted_at: attempt.submitted_at,
        started_at: attempt.started_at
      },
      event: {
        id: event.id,
        title: event.title,
        pass_percentage: event.pass_percentage
      },
      student
    });
  } catch (err) {
    console.error("❌ verify attempt error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PUBLIC — Verify by certificate code
// (e.g. GSSS-QZ-XXXXX)
// ============================================================
router.get("/verify/code/:code", async (req, res) => {
  try {
    const { code } = req.params;

    // Since we generate code deterministically, we search by matching format
    // For now, try to match by parsing attempt id from code suffix, or by direct lookup
    // Simpler: search any attempt whose generated code matches.

    // Generate a code from any recent attempt and compare — quick way is to
    // scan recent attempts (limit 500) and match the code.
    const attempts = await q(
      `SELECT * FROM quiz_attempts 
       WHERE status IN ('Submitted','AutoSubmitted')
       ORDER BY id DESC LIMIT 500`
    );

    let matched = null;
    for (const a of attempts) {
      const expected = generateCertCode(a.id, a.student_id);
      if (expected === code) { matched = a; break; }
    }

    if (!matched) {
      return res.status(404).json({ success: false, message: "Certificate code not found" });
    }

    const events = await q("SELECT * FROM quiz_events WHERE id = ?", [matched.event_id]);
    const event = events.length ? events[0] : {};

    const students = await q("SELECT student_id, name, class, father_name, mother_name, student_photo_url FROM Nstudent WHERE student_id = ?", [matched.student_id]);
    const student = students.length ? students[0] : null;

    res.json({
      success: true,
      attempt: {
        id: matched.id,
        student_id: matched.student_id,
        student_name: matched.student_name,
        student_class: matched.student_class,
        marks_obtained: matched.marks_obtained,
        total_marks: matched.total_marks,
        percentage: matched.percentage,
        correct_answers: matched.correct_answers,
        wrong_answers: matched.wrong_answers,
        submitted_at: matched.submitted_at,
        started_at: matched.started_at
      },
      event: {
        id: event.id,
        title: event.title,
        pass_percentage: event.pass_percentage
      },
      student
    });
  } catch (err) {
    console.error("❌ verify code error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — History
// ============================================================
router.get("/student/:studentId/history", async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await q(
      `SELECT a.*, e.title as event_title, e.pass_percentage 
       FROM quiz_attempts a 
       JOIN quiz_events e ON e.id = a.event_id
       WHERE a.student_id = ? 
       ORDER BY a.started_at DESC`,
      [studentId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
