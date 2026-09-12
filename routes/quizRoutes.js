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

const fmtDateTime = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
};

// ============================================================
// AUTO-START / AUTO-END ENGINE (runs every 30 seconds)
// ============================================================
setInterval(async () => {
  try {
    // Auto-start scheduled events
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
        console.log(`🟢 Auto-started quiz #${evt.id}: ${evt.title}`);
      }
    }

    // Auto-end scheduled events
    const toEnd = await q(
      `SELECT * FROM quiz_events 
       WHERE status = 'Live' 
         AND scheduled_end IS NOT NULL 
         AND scheduled_end <= NOW()`
    );

    for (const evt of toEnd) {
      await q("UPDATE quiz_events SET status = 'Ended', ended_at = NOW() WHERE id = ?", [evt.id]);
      // Auto-submit in-progress attempts
      await q(
        `UPDATE quiz_attempts SET status = 'AutoSubmitted', submitted_at = NOW()
         WHERE event_id = ? AND status = 'InProgress'`,
        [evt.id]
      );
      console.log(`🔴 Auto-ended quiz #${evt.id}: ${evt.title}`);
    }
  } catch (err) {
    // silent
  }
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

    // If status is Live (started immediately)
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
// ADMIN — GET SINGLE EVENT + QUESTIONS
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
// ADMIN — SAVE QUESTIONS (bulk replace)
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
// ADMIN — UPDATE EVENT
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
// ADMIN — GO LIVE NOW
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
// ADMIN — END NOW
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
    res.json({ success: true, message: "Event reset — all attempts cleared ✅" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// ADMIN — DELETE EVENT
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
// ADMIN — ATTEMPTS LIST
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
// STUDENT — Available quizzes
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

    const streamVal = ["11","12"].includes(String(studentClass)) ? (student[0].stream || "Non-Specialized") : "Non-Specialized";

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
    console.error("❌ available quizzes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — Start quiz
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

    // Check schedule window
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

    // Calculate remaining time
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
    console.error("❌ start quiz error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — Save answer
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
    console.error("❌ submit error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// CERTIFICATE PDF
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

    const logoBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/logo(1).png");
    const principalBuf = await fetchImageBuffer("https://gsssshilla07.pages.dev/principal.png");

    const passed = Number(attempt.percentage) >= Number(event.pass_percentage);
    const certType = passed ? "CERTIFICATE OF ACHIEVEMENT" : "CERTIFICATE OF PARTICIPATION";
    const certColor = passed ? "#16a34a" : "#c9972b";
    const certBg = passed ? "#f0fdf4" : "#fef8ed";

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="certificate-${attemptId}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;

    doc.rect(20, 20, PW - 40, PH - 40).lineWidth(4).strokeColor("#c9972b").stroke();
    doc.rect(30, 30, PW - 60, PH - 60).lineWidth(1).strokeColor("#c9972b").stroke();

    doc.save();
    doc.opacity(0.04);
    doc.fontSize(120).font("Helvetica-Bold").fillColor("#0d1b2a");
    doc.rotate(-30, { origin: [PW / 2, PH / 2] });
    doc.text("GSSS SHILLA", PW / 2 - 400, PH / 2 - 60, { width: 800, align: "center" });
    doc.restore();

    let y = 55;
    if (logoBuf) {
      try { doc.image(logoBuf, PW / 2 - 30, y, { width: 60, height: 60 }); } catch (e) {}
    }
    y += 70;

    doc.font("Helvetica-Bold").fontSize(24).fillColor("#0d1b2a")
      .text("GOVT. SR. SEC. SCHOOL SHILLA", 0, y, { width: PW, align: "center" });
    y += 28;
    doc.font("Helvetica").fontSize(11).fillColor("#5a6a7e")
      .text("Shilla • Nerwa • District Shimla • Himachal Pradesh - 171210", 0, y, { width: PW, align: "center" });
    y += 30;

    doc.moveTo(PW / 2 - 250, y).lineTo(PW / 2 + 250, y).lineWidth(2).strokeColor("#c9972b").stroke();
    y += 25;

    doc.font("Helvetica-Bold").fontSize(28).fillColor(certColor)
      .text(certType, 0, y, { width: PW, align: "center", characterSpacing: 3 });
    y += 45;

    doc.font("Helvetica-Oblique").fontSize(12).fillColor("#5a6a7e")
      .text("This is proudly presented to", 0, y, { width: PW, align: "center" });
    y += 30;

    doc.font("Helvetica-Bold").fontSize(34).fillColor("#0d1b2a")
      .text((attempt.student_name || "").toUpperCase(), 0, y, { width: PW, align: "center" });
    y += 48;

    doc.font("Helvetica").fontSize(13).fillColor("#5a6a7e")
      .text(`Class ${attempt.student_class} · Student ID: ${attempt.student_id}`, 0, y, { width: PW, align: "center" });
    y += 30;

    const certText = `for successfully participating in the "${event.title}" quiz event organized by Govt. Sr. Sec. School Shilla. The event was held on ${fmtDate(attempt.submitted_at || attempt.started_at)} and the participant scored ${attempt.marks_obtained} out of ${attempt.total_marks} marks (${attempt.percentage}%).`;

    doc.font("Helvetica").fontSize(12).fillColor("#1a2332")
      .text(certText, PW / 2 - 320, y, { width: 640, align: "center", lineGap: 4 });
    y += 70;

    const boxW = 420;
    const boxX = (PW - boxW) / 2;
    doc.rect(boxX, y, boxW, 55).fillAndStroke(certBg, certColor);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d1b2a")
      .text("SCORE", boxX, y + 8, { width: boxW, align: "center" });
    doc.font("Helvetica-Bold").fontSize(22).fillColor(certColor)
      .text(`${attempt.marks_obtained} / ${attempt.total_marks} (${attempt.percentage}%)`, boxX, y + 24, { width: boxW, align: "center" });

    y += 80;

    const sigY = PH - 130;
    if (principalBuf) {
      try { doc.image(principalBuf, PW / 2 + 90, sigY - 30, { width: 110, height: 55 }); } catch (e) {}
    }
    doc.moveTo(PW / 2 + 70, sigY + 30).lineTo(PW / 2 + 220, sigY + 30).lineWidth(1.2).strokeColor("#0d1b2a").stroke();
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d1b2a")
      .text("Principal", PW / 2 + 70, sigY + 38, { width: 150, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#5a6a7e")
      .text("Govt. Sr. Sec. School Shilla", PW / 2 + 70, sigY + 54, { width: 150, align: "center" });

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0d1b2a")
      .text("Certificate ID:", 70, sigY + 20);
    doc.font("Helvetica").fontSize(10).fillColor("#c9972b")
      .text(`CERT-${attemptId}-${attempt.student_id}`, 70, sigY + 36);
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8")
      .text(`Issued on: ${fmtDate(new Date())}`, 70, sigY + 52);

    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#94a3b8")
      .text("This is a computer-generated certificate issued by GSSS Shilla.", 0, PH - 35, { width: PW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("❌ certificate PDF error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// STUDENT — My history
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
