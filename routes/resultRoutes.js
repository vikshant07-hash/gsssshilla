// ============================================================
// SCHOOL EXAMINATION & RESULT MANAGEMENT SYSTEM
// Complete Production Backend — resultRoutes.js
// 4-Table + 2-Backup Design
//
// ✅ Nstudent is the SINGLE SOURCE OF TRUTH for all student data
//    (class, section, stream, session, photo, etc.)
// ✅ erp_* tables only store config, exams, marks, results
// ✅ Permanent snapshots in backup tables (survive everything)
// ✅ No student data duplication
// ============================================================

const express = require("express");
const router = express.Router();
const db = require("../config/db");

// ============================================================
// CORE UTILITIES
// ============================================================
const q = (sql, params = []) => db.query(sql, params);
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, data = null, message = "Success", status = 200, extra = {}) =>
    res.status(status).json({ success: true, message, data, ...extra });

const fail = (res, message = "Something went wrong", status = 400, extra = {}) =>
    res.status(status).json({ success: false, message, ...extra });

const log = {
    info: (msg, meta = {}) => console.log(`ℹ️  [RESULT] ${msg}`, Object.keys(meta).length ? meta : ""),
    warn: (msg, meta = {}) => console.warn(`⚠️  [RESULT] ${msg}`, Object.keys(meta).length ? meta : ""),
    error: (msg, meta = {}) => console.error(`❌ [RESULT] ${msg}`, Object.keys(meta).length ? meta : ""),
    success: (msg, meta = {}) => console.log(`✅ [RESULT] ${msg}`, Object.keys(meta).length ? meta : "")
};

// ============================================================
// CONSTANTS
// ============================================================
const EXAM_STATUS = {
    DRAFT: "DRAFT",
    IN_PROGRESS: "IN_PROGRESS",
    SUBMITTED: "SUBMITTED",
    VERIFIED: "VERIFIED",
    FINALIZED: "FINALIZED",
    PUBLISHED: "PUBLISHED",
    UNPUBLISHED: "UNPUBLISHED"
};

const ABSENT_TYPES = ["Present", "Absent", "Medical", "Not_Appeared", "Withheld"];
const VALID_CLASS_GROUPS = ["PRIMARY", "MIDDLE", "SECONDARY", "SENIOR"];
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 200;

// ============================================================
// VALIDATION HELPERS
// ============================================================
function requireFields(body, fields) {
    const missing = [];
    for (const f of fields) {
        if (body[f] === undefined || body[f] === null || String(body[f]).trim() === "") {
            missing.push(f);
        }
    }
    if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(", ")}`);
    }
}

function parseId(raw, fieldName = "id") {
    const id = parseInt(raw, 10);
    if (isNaN(id) || id <= 0) throw new Error(`Invalid ${fieldName}`);
    return id;
}

function parsePagination(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(
        Math.max(parseInt(query.limit, 10) || DEFAULT_PAGE_LIMIT, 1),
        MAX_PAGE_LIMIT
    );
    return { page, limit, offset: (page - 1) * limit };
}

function safeJSONParse(raw, fallback = null) {
    if (raw === null || raw === undefined || raw === "") return fallback;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function safeJSONStringify(obj) {
    if (obj === null || obj === undefined) return null;
    try { return JSON.stringify(obj); } catch (e) { return null; }
}

function trimStr(v, maxLen = 500) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === "") return null;
    return s.slice(0, maxLen);
}

function toDecimal(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
}

function toInt(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
}

function toFloatSafe(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

// ============================================================
// USER CONTEXT (from auth middleware)
// ============================================================
function getUserContext(req) {
    const u = req.user || req.admin || {};
    return {
        user_id: String(u.id || u.user_id || u.admin_id || "SYSTEM"),
        user_name: String(u.name || u.username || "System"),
        user_role: String(u.role || "ADMIN"),
        ip_address: String(req.ip || req.headers["x-forwarded-for"] || "").slice(0, 50),
        user_agent: String(req.headers["user-agent"] || "").slice(0, 500)
    };
}

// ============================================================
// AUDIT LOGGING
// ============================================================
async function auditLog({
    action, entity_type, entity_id = null,
    student_id = null, session_id = null, exam_id = null, subject_id = null,
    user, old_value = null, new_value = null,
    reason = null, status = "SUCCESS", error_message = null
}) {
    try {
        await q(`
            INSERT INTO erp_audit_logs (
                action, entity_type, entity_id,
                student_id, session_id, exam_id, subject_id,
                user_id, user_name, user_role,
                old_value, new_value, reason,
                ip_address, user_agent, status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            action, entity_type, entity_id,
            student_id, session_id, exam_id, subject_id,
            user?.user_id || null, user?.user_name || null, user?.user_role || null,
            safeJSONStringify(old_value), safeJSONStringify(new_value), reason,
            user?.ip_address || null, user?.user_agent || null, status, error_message
        ]);
    } catch (err) {
        log.error("Audit log failed", { error: err.message, action });
    }
}

// ============================================================
// ✅ STUDENT DATA — SINGLE SOURCE OF TRUTH: Nstudent
// ============================================================
/**
 * Fetch complete student data from Nstudent table.
 * This is the ONLY function that reads student details.
 * Class, section, stream, session — sab Nstudent se aata hai.
 */
async function getStudentFromNstudent(studentId) {
    const rows = await q(`
        SELECT
            id, student_id, admission_number, apaar_id,
            name, father_name, mother_name, dob, gender, category,
            class, section, stream, session, roll_number,
            student_photo_url AS photo,
            signature_url,
            aadhar_number,
            mobile_number, email_id,
            status,
            address, village, post_office, tehsil, district, state, pincode,
            promoted_from, promotion_date
        FROM Nstudent
        WHERE student_id = ?
        LIMIT 1
    `, [studentId]);

    if (rows.length === 0) {
        throw new Error(`Student not found: ${studentId}`);
    }
    return rows[0];
}

/**
 * Resolve class_id, section_id, stream_id, session_id
 * from erp_master using the student's class/session values.
 * Fallback graceful — agar match nahi mila to null return.
 */
async function resolveMasterIdsFromStudent(student, sessionId = null) {
    const result = {
        class_id: null,
        section_id: null,
        stream_id: null,
        session_id: sessionId || null
    };

    // Class
    if (student.class) {
        const cls = await q(
            `SELECT id FROM erp_master WHERE master_type = 'CLASS' AND master_key = ? LIMIT 1`,
            [String(student.class)]
        );
        if (cls.length) result.class_id = cls[0].id;
    }

    // Section
    if (student.section && result.class_id) {
        const sec = await q(
            `SELECT id FROM erp_master 
             WHERE master_type = 'SECTION' AND parent_id = ? AND master_key = ? LIMIT 1`,
            [result.class_id, String(student.section)]
        );
        if (sec.length) result.section_id = sec[0].id;
    }

    // Stream
    if (student.stream) {
        const str = await q(
            `SELECT id FROM erp_master WHERE master_type = 'STREAM' AND master_key = ? LIMIT 1`,
            [String(student.stream).toUpperCase()]
        );
        if (str.length) result.stream_id = str[0].id;
    }

    // Session
    if (!result.session_id && student.session) {
        const ses = await q(
            `SELECT id FROM erp_master WHERE master_type = 'SESSION' AND master_key = ? LIMIT 1`,
            [String(student.session)]
        );
        if (ses.length) result.session_id = ses[0].id;
    }

    return result;
}

// ============================================================
// GRADING HELPERS
// ============================================================
let _gradeCache = { scheme_id: null, items: null, ts: 0 };

async function getGradingItems(schemeId = null) {
    const now = Date.now();
    if (_gradeCache.items && _gradeCache.scheme_id === schemeId && (now - _gradeCache.ts) < 60000) {
        return _gradeCache.items;
    }

    let scheme;
    if (schemeId) {
        const rows = await q(
            `SELECT id FROM erp_master WHERE id = ? AND master_type = 'GRADING_SCHEME' LIMIT 1`,
            [schemeId]
        );
        scheme = rows[0];
    } else {
        const rows = await q(
            `SELECT id FROM erp_master WHERE master_type = 'GRADING_SCHEME' 
             AND (data->>'$.is_default' = 'true' OR data->>'$.is_default' = '1') LIMIT 1`
        );
        scheme = rows[0];
        if (!scheme) {
            const rows2 = await q(
                `SELECT id FROM erp_master WHERE master_type = 'GRADING_SCHEME' 
                 ORDER BY display_order ASC LIMIT 1`
            );
            scheme = rows2[0];
        }
    }

    if (!scheme) return getDefaultGrading();

    const items = await q(`
        SELECT master_key, name, data
        FROM erp_master
        WHERE master_type = 'GRADING_ITEM' AND parent_id = ? AND is_active = 1
        ORDER BY display_order ASC
    `, [scheme.id]);

    if (items.length === 0) return getDefaultGrading();

    const parsed = items.map(i => {
        const d = safeJSONParse(i.data, {});
        return {
            min: parseFloat(d.min_percent ?? 0),
            max: parseFloat(d.max_percent ?? 100),
            grade: i.name || i.master_key,
            grade_point: parseFloat(d.grade_point ?? 0)
        };
    });

    _gradeCache = { scheme_id: scheme.id, items: parsed, ts: now };
    return parsed;
}

function getDefaultGrading() {
    return [
        { min: 90, max: 100, grade: "A+", grade_point: 10 },
        { min: 80, max: 89.99, grade: "A", grade_point: 9 },
        { min: 70, max: 79.99, grade: "B+", grade_point: 8 },
        { min: 60, max: 69.99, grade: "B", grade_point: 7 },
        { min: 50, max: 59.99, grade: "C", grade_point: 6 },
        { min: 40, max: 49.99, grade: "D", grade_point: 5 },
        { min: 0, max: 39.99, grade: "E", grade_point: 0 }
    ];
}

async function calculateGrade(percentage) {
    const items = await getGradingItems();
    for (const g of items) {
        if (percentage >= g.min && percentage <= g.max) return g.grade;
    }
    return "E";
}

function getGradeSync(percentage) {
    const items = getDefaultGrading();
    for (const g of items) {
        if (percentage >= g.min && percentage <= g.max) return g.grade;
    }
    return "E";
}

// ============================================================
// VALIDATION HELPERS
// ============================================================
async function getMasterById(id, expectedType = null) {
    const rows = await q(`SELECT * FROM erp_master WHERE id = ? LIMIT 1`, [id]);
    if (rows.length === 0) throw new Error(`Master record not found: ${id}`);
    if (expectedType && rows[0].master_type !== expectedType) {
        throw new Error(`Expected ${expectedType}, got ${rows[0].master_type}`);
    }
    return rows[0];
}

async function getMasterByKey(type, key) {
    const rows = await q(
        `SELECT * FROM erp_master WHERE master_type = ? AND master_key = ? LIMIT 1`,
        [type, key]
    );
    return rows[0] || null;
}

// ============================================================
// BACKUP SNAPSHOT HELPERS
// ============================================================
/**
 * Snapshot marks into erp_marks_backup.
 * Called when result is FINALIZED or PUBLISHED.
 */
async function snapshotMarks({ student_id, session_id, exam_id, reason = "FINALIZED", user }) {
    const rows = await q(`
        SELECT m.*, sub.name AS subject_name
        FROM erp_marks m
        LEFT JOIN erp_master sub ON sub.id = m.subject_id
        WHERE m.record_type = 'MARKS'
          AND m.student_id = ?
          AND m.session_id = ?
          AND m.exam_id = ?
    `, [student_id, session_id, exam_id]);

    if (rows.length === 0) return 0;

    let count = 0;
    for (const r of rows) {
        await q(`
            INSERT INTO erp_marks_backup (
                original_marks_id, student_id, session_id, class_id,
                exam_id, subject_id, subject_name,
                theory_marks, practical_marks, internal_marks, project_marks,
                total_marks, max_marks, grade, is_absent, absent_type, remarks,
                snapshot_reason, snapshot_data,
                original_created_at, original_updated_at, snapshot_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                theory_marks = VALUES(theory_marks),
                practical_marks = VALUES(practical_marks),
                internal_marks = VALUES(internal_marks),
                project_marks = VALUES(project_marks),
                total_marks = VALUES(total_marks),
                max_marks = VALUES(max_marks),
                grade = VALUES(grade),
                is_absent = VALUES(is_absent),
                absent_type = VALUES(absent_type),
                remarks = VALUES(remarks),
                snapshot_reason = VALUES(snapshot_reason),
                snapshot_data = VALUES(snapshot_data),
                snapshot_at = CURRENT_TIMESTAMP,
                snapshot_by = VALUES(snapshot_by)
        `, [
            r.id, r.student_id, r.session_id, r.class_id,
            r.exam_id, r.subject_id, r.subject_name,
            r.theory_marks, r.practical_marks, r.internal_marks, r.project_marks,
            r.total_marks, r.max_marks, r.grade, r.is_absent, r.absent_type, r.remarks,
            reason, safeJSONStringify(r),
            r.created_at, r.updated_at, user?.user_id || null
        ]);
        count++;
    }
    return count;
}

/**
 * ✅ Snapshot consolidated result into erp_results_backup.
 * Reads student data from Nstudent — COMPLETE fields.
 * This snapshot is PERMANENT until admin deletes it.
 */
async function snapshotResult({
    student_id, session_id, class_id, exam_id,
    result_type = "EXAM", reason = "FINALIZED", user
}) {
    // ✅ Fetch COMPLETE student data from Nstudent
    let stu;
    try {
        stu = await getStudentFromNstudent(student_id);
    } catch (err) {
        log.warn("Cannot snapshot — student not found", { student_id });
        return 0;
    }

    // Fetch exam name
    let examName = null;
    if (exam_id) {
        const exams = await q(
            `SELECT name FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
            [exam_id]
        );
        examName = exams[0]?.name || null;
    }

    // Fetch all marks for this student+exam
    let marksRows = [];
    if (exam_id) {
        marksRows = await q(`
            SELECT m.*, sub.name AS subject_name
            FROM erp_marks m
            LEFT JOIN erp_master sub ON sub.id = m.subject_id
            WHERE m.record_type = 'MARKS'
              AND m.student_id = ?
              AND m.session_id = ?
              AND m.exam_id = ?
            ORDER BY sub.display_order ASC
        `, [student_id, session_id, exam_id]);
    } else {
        marksRows = await q(`
            SELECT m.*, sub.name AS subject_name
            FROM erp_marks m
            LEFT JOIN erp_master sub ON sub.id = m.subject_id
            WHERE m.record_type = 'MARKS'
              AND m.student_id = ?
              AND m.session_id = ?
            ORDER BY sub.display_order ASC
        `, [student_id, session_id]);
    }

    // Calculate totals
    let grandTotal = 0, maxTotal = 0;
    const subjectWise = [];
    const failedSubjects = [];
    let hasAbsent = false, hasWithheld = false;

    for (const m of marksRows) {
        const total = parseFloat(m.total_marks) || 0;
        const max = parseFloat(m.max_marks) || 0;
        grandTotal += total;
        maxTotal += max;

        if (["Absent", "Medical", "Not_Appeared"].includes(m.absent_type)) hasAbsent = true;
        if (m.absent_type === "Withheld") hasWithheld = true;

        subjectWise.push({
            subject_id: m.subject_id,
            subject_name: m.subject_name,
            theory: m.theory_marks,
            practical: m.practical_marks,
            internal: m.internal_marks,
            project: m.project_marks,
            total: m.total_marks,
            max: m.max_marks,
            grade: m.grade,
            absent_type: m.absent_type,
            remarks: m.remarks
        });

        // Subject-level pass/fail check
        const examSub = await q(`
            SELECT data FROM erp_exams
            WHERE record_type = 'EXAM_SUBJECT'
              AND exam_id = ? AND subject_id = ?
            LIMIT 1
        `, [exam_id, m.subject_id]);
        const passMarks = examSub[0]?.data
            ? (safeJSONParse(examSub[0].data)?.pass_marks || 33)
            : 33;

        if (m.absent_type === "Present" && total < passMarks) {
            failedSubjects.push(m.subject_name);
        }
    }

    const percentage = maxTotal > 0
        ? parseFloat(((grandTotal / maxTotal) * 100).toFixed(2))
        : 0;
    const overallGrade = await calculateGrade(percentage);

    let resultStatus = "Pass";
    if (hasWithheld) resultStatus = "Withheld";
    else if (hasAbsent) resultStatus = "Absent";
    else if (failedSubjects.length > 0) resultStatus = "Fail";
    else if (percentage < 33) resultStatus = "Fail";

    // ✅ Insert with COMPLETE student details from Nstudent
    await q(`
        INSERT INTO erp_results_backup (
            student_id, session_id, class_id, exam_id, result_type,
            student_name, admission_number, apaar_id, roll_number,
            father_name, mother_name, dob, gender, category,
            class_name, section_name, stream, session_name,
            mobile_number, email_id, address,
            photo_url, signature_url,
            exam_name, grand_total, max_total, percentage, overall_grade,
            result_status, failed_subjects, subject_wise_marks,
            snapshot_reason, snapshot_by
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?
        )
        ON DUPLICATE KEY UPDATE
            student_name = VALUES(student_name),
            admission_number = VALUES(admission_number),
            apaar_id = VALUES(apaar_id),
            roll_number = VALUES(roll_number),
            father_name = VALUES(father_name),
            mother_name = VALUES(mother_name),
            dob = VALUES(dob),
            gender = VALUES(gender),
            category = VALUES(category),
            class_name = VALUES(class_name),
            section_name = VALUES(section_name),
            stream = VALUES(stream),
            session_name = VALUES(session_name),
            mobile_number = VALUES(mobile_number),
            email_id = VALUES(email_id),
            address = VALUES(address),
            photo_url = VALUES(photo_url),
            signature_url = VALUES(signature_url),
            exam_name = VALUES(exam_name),
            grand_total = VALUES(grand_total),
            max_total = VALUES(max_total),
            percentage = VALUES(percentage),
            overall_grade = VALUES(overall_grade),
            result_status = VALUES(result_status),
            failed_subjects = VALUES(failed_subjects),
            subject_wise_marks = VALUES(subject_wise_marks),
            snapshot_reason = VALUES(snapshot_reason),
            snapshot_by = VALUES(snapshot_by),
            snapshot_at = CURRENT_TIMESTAMP
    `, [
        student_id, session_id, class_id, exam_id, result_type,
        stu.name, stu.admission_number, stu.apaar_id, stu.roll_number,
        stu.father_name, stu.mother_name, stu.dob, stu.gender, stu.category,
        stu.class, stu.section, stu.stream, stu.session,
        stu.mobile_number, stu.email_id, stu.address,
        stu.photo, stu.signature_url,
        examName, grandTotal, maxTotal, percentage, overallGrade,
        resultStatus,
        safeJSONStringify(failedSubjects),
        safeJSONStringify(subjectWise),
        reason, user?.user_id || null
    ]);

    return 1;
}

// ============================================================
// ============================================================
// SECTION 1: ACADEMIC SESSIONS
// ============================================================
// ============================================================

router.get("/sessions", asyncHandler(async (req, res) => {
    const rows = await q(`
        SELECT id, master_key AS session_code, name AS session_name,
               display_order, is_active, is_current, data, created_at, updated_at
        FROM erp_master
        WHERE master_type = 'SESSION'
        ORDER BY display_order DESC
    `);

    const sessions = rows.map(r => ({
        ...r,
        ...safeJSONParse(r.data, {}),
        is_active: !!r.is_active,
        is_current: !!r.is_current
    }));

    return ok(res, sessions, "Sessions fetched successfully");
}));

router.post("/sessions", asyncHandler(async (req, res) => {
    requireFields(req.body, ["session_code", "session_name"]);
    const user = getUserContext(req);
    const { session_code, session_name, start_date, end_date, is_current } = req.body;

    const existing = await getMasterByKey("SESSION", session_code);
    if (existing) return fail(res, `Session already exists: ${session_code}`, 409);

    if (is_current) {
        await q(`UPDATE erp_master SET is_current = 0 WHERE master_type = 'SESSION'`);
    }

    const maxOrder = await q(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM erp_master WHERE master_type = 'SESSION'`
    );

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, is_current, data, created_by)
        VALUES ('SESSION', ?, ?, ?, 1, ?, ?, ?)
    `, [
        session_code, session_name, maxOrder[0].next_order,
        is_current ? 1 : 0,
        safeJSONStringify({ start_date, end_date }),
        user.user_id
    ]);

    await auditLog({
        action: "SESSION_CREATED", entity_type: "SESSION",
        entity_id: result.insertId, user,
        new_value: { session_code, session_name, start_date, end_date, is_current }
    });

    return ok(res, { id: result.insertId, session_code }, "Session created successfully", 201);
}));

router.put("/sessions/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const session = await getMasterById(id, "SESSION");
    const { session_name, start_date, end_date, is_active, is_current } = req.body;

    if (is_current) {
        await q(`UPDATE erp_master SET is_current = 0 WHERE master_type = 'SESSION' AND id != ?`, [id]);
    }

    const newData = {
        ...(safeJSONParse(session.data, {})),
        ...(start_date !== undefined ? { start_date } : {}),
        ...(end_date !== undefined ? { end_date } : {})
    };

    await q(`
        UPDATE erp_master
        SET name = COALESCE(?, name),
            is_active = COALESCE(?, is_active),
            is_current = COALESCE(?, is_current),
            data = ?, updated_by = ?
        WHERE id = ?
    `, [
        session_name ?? null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        is_current !== undefined ? (is_current ? 1 : 0) : null,
        safeJSONStringify(newData), user.user_id, id
    ]);

    await auditLog({
        action: "SESSION_UPDATED", entity_type: "SESSION", entity_id: id, user,
        old_value: session, new_value: { session_name, start_date, end_date, is_active, is_current }
    });

    return ok(res, { id }, "Session updated successfully");
}));

router.delete("/sessions/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    await getMasterById(id, "SESSION");

    const exams = await q(`SELECT COUNT(*) AS cnt FROM erp_exams WHERE session_id = ?`, [id]);
    if (exams[0].cnt > 0) {
        return fail(res, `Cannot delete session: ${exams[0].cnt} exam(s) exist`, 400);
    }

    await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    await auditLog({ action: "SESSION_DELETED", entity_type: "SESSION", entity_id: id, user });

    return ok(res, null, "Session deleted successfully");
}));

// ============================================================
// SECTION 2: CLASSES
// ============================================================
router.get("/classes", asyncHandler(async (req, res) => {
    const { group } = req.query;
    let sql = `SELECT id, master_key AS class_name, name, display_order, is_active, data, created_at
               FROM erp_master WHERE master_type = 'CLASS'`;
    const params = [];
    if (group) { sql += ` AND data->>'$.class_group' = ?`; params.push(group); }
    sql += ` ORDER BY display_order ASC`;

    const rows = await q(sql, params);
    const classes = rows.map(r => ({
        ...r,
        ...safeJSONParse(r.data, {}),
        is_active: !!r.is_active
    }));
    return ok(res, classes, "Classes fetched successfully");
}));

router.post("/classes", asyncHandler(async (req, res) => {
    requireFields(req.body, ["class_name", "class_group"]);
    const user = getUserContext(req);
    const { class_name, class_group, display_order } = req.body;

    if (!VALID_CLASS_GROUPS.includes(class_group)) {
        return fail(res, `Invalid class_group`, 400);
    }

    const existing = await getMasterByKey("CLASS", class_name);
    if (existing) return fail(res, `Class already exists: ${class_name}`, 409);

    const maxOrder = await q(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM erp_master WHERE master_type = 'CLASS'`
    );

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('CLASS', ?, ?, ?, 1, ?, ?)
    `, [
        class_name, `Class ${class_name}`,
        display_order || maxOrder[0].next_order,
        safeJSONStringify({ class_group }), user.user_id
    ]);

    await auditLog({
        action: "CLASS_CREATED", entity_type: "CLASS",
        entity_id: result.insertId, user,
        new_value: { class_name, class_group }
    });

    return ok(res, { id: result.insertId, class_name }, "Class created successfully", 201);
}));

// ============================================================
// SECTION 3: SECTIONS
// ============================================================
router.get("/sections", asyncHandler(async (req, res) => {
    const { class_id } = req.query;
    let sql = `SELECT s.id, s.master_key AS section_name, s.name, s.parent_id,
                      s.display_order, s.is_active, s.data
               FROM erp_master s WHERE s.master_type = 'SECTION'`;
    const params = [];
    if (class_id) { sql += ` AND s.parent_id = ?`; params.push(parseId(class_id, "class_id")); }
    sql += ` ORDER BY s.display_order ASC`;

    const rows = await q(sql, params);
    return ok(res, rows, "Sections fetched successfully");
}));

router.post("/sections", asyncHandler(async (req, res) => {
    requireFields(req.body, ["section_name", "class_id"]);
    const user = getUserContext(req);
    const { section_name, class_id, capacity } = req.body;

    const classId = parseId(class_id, "class_id");
    await getMasterById(classId, "CLASS");

    const dup = await q(
        `SELECT id FROM erp_master WHERE master_type = 'SECTION' AND master_key = ? AND parent_id = ? LIMIT 1`,
        [section_name, classId]
    );
    if (dup.length > 0) return fail(res, `Section ${section_name} already exists`, 409);

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, parent_id, display_order, is_active, data, created_by)
        VALUES ('SECTION', ?, ?, ?, ?, 1, ?, ?)
    `, [
        section_name, `Section ${section_name}`,
        classId, toInt(req.body.display_order) || 1,
        safeJSONStringify({ capacity: toInt(capacity) }),
        user.user_id
    ]);

    await auditLog({
        action: "SECTION_CREATED", entity_type: "SECTION",
        entity_id: result.insertId, user,
        new_value: { section_name, class_id: classId }
    });

    return ok(res, { id: result.insertId, section_name }, "Section created successfully", 201);
}));

// ============================================================
// SECTION 4: STREAMS
// ============================================================
router.get("/streams", asyncHandler(async (req, res) => {
    const rows = await q(`
        SELECT id, master_key AS stream_code, name AS stream_name,
               display_order, is_active, data
        FROM erp_master WHERE master_type = 'STREAM' AND is_active = 1
        ORDER BY display_order ASC
    `);
    return ok(res, rows, "Streams fetched successfully");
}));

router.post("/streams", asyncHandler(async (req, res) => {
    requireFields(req.body, ["stream_name", "stream_code"]);
    const user = getUserContext(req);
    const { stream_name, stream_code } = req.body;

    const existing = await getMasterByKey("STREAM", stream_code);
    if (existing) return fail(res, `Stream already exists: ${stream_code}`, 409);

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('STREAM', ?, ?, ?, 1, ?, ?)
    `, [
        stream_code, stream_name,
        toInt(req.body.display_order) || 1,
        safeJSONStringify({ stream_name }),
        user.user_id
    ]);

    await auditLog({
        action: "STREAM_CREATED", entity_type: "STREAM",
        entity_id: result.insertId, user,
        new_value: { stream_name, stream_code }
    });

    return ok(res, { id: result.insertId, stream_code }, "Stream created successfully", 201);
}));

// ============================================================
// SECTION 5: SUBJECTS
// ============================================================
router.get("/subjects", asyncHandler(async (req, res) => {
    const { type, search, is_active } = req.query;

    let sql = `SELECT id, master_key AS subject_code, name AS subject_name,
                      display_order, is_active, data, created_at
               FROM erp_master WHERE master_type = 'SUBJECT'`;
    const params = [];

    if (type) { sql += ` AND data->>'$.subject_type' = ?`; params.push(type); }
    if (search) {
        sql += ` AND (name LIKE ? OR master_key LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }
    if (is_active !== undefined && is_active !== "") {
        sql += ` AND is_active = ?`;
        params.push(is_active === "true" || is_active === "1" ? 1 : 0);
    }
    sql += ` ORDER BY display_order ASC, name ASC`;

    const rows = await q(sql, params);
    const subjects = rows.map(r => ({
        ...r,
        ...safeJSONParse(r.data, {}),
        is_active: !!r.is_active
    }));
    return ok(res, subjects, "Subjects fetched successfully");
}));

router.post("/subjects", asyncHandler(async (req, res) => {
    requireFields(req.body, ["subject_code", "subject_name"]);
    const user = getUserContext(req);
    const {
        subject_code, subject_name, subject_short_name,
        subject_type = "Core", component_type = "Theory", display_order
    } = req.body;

    const existing = await getMasterByKey("SUBJECT", subject_code);
    if (existing) return fail(res, `Subject already exists: ${subject_code}`, 409);

    const maxOrder = await q(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM erp_master WHERE master_type = 'SUBJECT'`
    );

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('SUBJECT', ?, ?, ?, 1, ?, ?)
    `, [
        subject_code, subject_name,
        toInt(display_order) || maxOrder[0].next_order,
        safeJSONStringify({
            subject_short_name: subject_short_name || subject_name,
            subject_type, component_type
        }),
        user.user_id
    ]);

    await auditLog({
        action: "SUBJECT_CREATED", entity_type: "SUBJECT",
        entity_id: result.insertId, user,
        new_value: { subject_code, subject_name, subject_type, component_type }
    });

    return ok(res, { id: result.insertId, subject_code }, "Subject created successfully", 201);
}));

router.put("/subjects/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const subject = await getMasterById(id, "SUBJECT");
    const { subject_name, subject_short_name, subject_type, component_type, is_active } = req.body;

    const newData = {
        ...safeJSONParse(subject.data, {}),
        ...(subject_short_name !== undefined ? { subject_short_name } : {}),
        ...(subject_type !== undefined ? { subject_type } : {}),
        ...(component_type !== undefined ? { component_type } : {})
    };

    await q(`
        UPDATE erp_master
        SET name = COALESCE(?, name),
            is_active = COALESCE(?, is_active),
            data = ?, updated_by = ?
        WHERE id = ?
    `, [
        subject_name ?? null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        safeJSONStringify(newData), user.user_id, id
    ]);

    await auditLog({
        action: "SUBJECT_UPDATED", entity_type: "SUBJECT", entity_id: id,
        user, old_value: subject, new_value: req.body
    });

    return ok(res, { id }, "Subject updated successfully");
}));

// ============================================================
// SECTION 6: CLASS-SUBJECT MAPPING
// ============================================================
router.get("/class-subjects", asyncHandler(async (req, res) => {
    const { class_id, stream_id } = req.query;
    requireFields(req.query, ["class_id"]);

    let sql = `
        SELECT cs.id, cs.parent_id AS class_id, cs.master_key, cs.data,
               cs.is_active, cs.display_order,
               sub.id AS subject_id, sub.master_key AS subject_code, sub.name AS subject_name,
               sub.data AS subject_data
        FROM erp_master cs
        JOIN erp_master sub ON sub.id = (cs.data->>'$.subject_id')
        WHERE cs.master_type = 'CLASS_SUBJECT' AND cs.parent_id = ?
    `;
    const params = [parseId(class_id, "class_id")];

    if (stream_id) {
        sql += ` AND cs.data->>'$.stream_id' = ?`;
        params.push(String(stream_id));
    }
    sql += ` ORDER BY cs.display_order ASC`;

    const rows = await q(sql, params);
    const result = rows.map(r => ({
        id: r.id,
        class_id: r.class_id,
        subject_id: r.subject_id,
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        subject_data: safeJSONParse(r.subject_data, {}),
        is_optional: safeJSONParse(r.data, {})?.is_optional || false,
        stream_id: safeJSONParse(r.data, {})?.stream_id || null,
        is_active: !!r.is_active
    }));
    return ok(res, result, "Class subjects fetched successfully");
}));

router.post("/class-subjects", asyncHandler(async (req, res) => {
    requireFields(req.body, ["class_id", "subject_ids"]);
    const user = getUserContext(req);

    const classId = parseId(req.body.class_id, "class_id");
    await getMasterById(classId, "CLASS");

    const subjectIds = Array.isArray(req.body.subject_ids)
        ? req.body.subject_ids
        : [req.body.subject_ids];
    const streamId = req.body.stream_id ? parseId(req.body.stream_id, "stream_id") : null;

    let added = 0;
    for (const sid of subjectIds) {
        const subjectId = parseId(sid, "subject_id");
        await getMasterById(subjectId, "SUBJECT");

        const dup = await q(`
            SELECT id FROM erp_master
            WHERE master_type = 'CLASS_SUBJECT' AND parent_id = ?
              AND data->>'$.subject_id' = ?
              AND (data->>'$.stream_id' = ? OR (? IS NULL AND data->>'$.stream_id' IS NULL))
            LIMIT 1
        `, [classId, String(subjectId), streamId ? String(streamId) : null, streamId ? String(streamId) : null]);

        if (dup.length > 0) continue;

        const maxOrder = await q(
            `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order 
             FROM erp_master WHERE master_type = 'CLASS_SUBJECT' AND parent_id = ?`,
            [classId]
        );

        await q(`
            INSERT INTO erp_master (master_type, master_key, name, parent_id, display_order, is_active, data, created_by)
            VALUES ('CLASS_SUBJECT', ?, ?, ?, ?, 1, ?, ?)
        `, [
            `CS_${classId}_${subjectId}`, `Class-Subject ${classId}-${subjectId}`,
            classId, maxOrder[0].next_order,
            safeJSONStringify({ subject_id: subjectId, stream_id: streamId, is_optional: false }),
            user.user_id
        ]);
        added++;
    }

    await auditLog({
        action: "CLASS_SUBJECTS_ADDED", entity_type: "CLASS_SUBJECT", user,
        new_value: { class_id: classId, subject_ids: subjectIds, stream_id: streamId, added }
    });

    return ok(res, { added, requested: subjectIds.length }, `${added} subject(s) added to class`);
}));

router.delete("/class-subjects/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    await getMasterById(id, "CLASS_SUBJECT");
    await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    await auditLog({
        action: "CLASS_SUBJECT_REMOVED", entity_type: "CLASS_SUBJECT",
        entity_id: id, user
    });
    return ok(res, null, "Class-subject removed successfully");
}));

// ============================================================
// SECTION 7: STUDENT-SUBJECT ASSIGNMENT
// ============================================================
/**
 * Student-subject assignment.
 * Uses Nstudent for class/section/stream — reads them there.
 */
router.get("/student-subjects/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.query;

    // Verify student exists
    const student = await getStudentFromNstudent(studentId);

    let sql = `
        SELECT ss.id, ss.student_id, ss.session_id, ss.class_id,
               ss.section_id, ss.stream_id, ss.subject_id,
               ss.status, ss.data, ss.created_at,
               sub.master_key AS subject_code, sub.name AS subject_name,
               sub.data AS subject_data
        FROM erp_marks ss
        JOIN erp_master sub ON sub.id = ss.subject_id
        WHERE ss.record_type = 'STUDENT_SUBJECT' AND ss.student_id = ?
    `;
    const params = [studentId];

    if (session_id) {
        sql += ` AND ss.session_id = ?`;
        params.push(parseId(session_id, "session_id"));
    }
    sql += ` ORDER BY sub.display_order ASC`;

    const rows = await q(sql, params);
    const result = rows.map(r => ({
        id: r.id,
        student_id: r.student_id,
        session_id: r.session_id,
        class_id: r.class_id,
        section_id: r.section_id,
        stream_id: r.stream_id,
        subject_id: r.subject_id,
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        subject_data: safeJSONParse(r.subject_data, {}),
        is_optional: safeJSONParse(r.data, {})?.is_optional || false,
        status: r.status,
        is_active: r.status === "ACTIVE"
    }));

    return ok(res, {
        student: {
            student_id: student.student_id,
            name: student.name,
            class: student.class,
            section: student.section,
            stream: student.stream,
            session: student.session,
            roll_number: student.roll_number
        },
        subjects: result
    }, "Student subjects fetched successfully");
}));

router.post("/student-subjects/assign", asyncHandler(async (req, res) => {
    requireFields(req.body, ["student_id", "session_id", "subject_ids"]);
    const user = getUserContext(req);

    const studentId = String(req.body.student_id).trim();
    const sessionId = parseId(req.body.session_id, "session_id");

    // ✅ Fetch student — class/section/stream automatically derived
    const student = await getStudentFromNstudent(studentId);
    const masterIds = await resolveMasterIdsFromStudent(student, sessionId);

    if (!masterIds.class_id) {
        return fail(res, `Class "${student.class}" not found in master config.`, 400);
    }

    const subjectIds = Array.isArray(req.body.subject_ids)
        ? req.body.subject_ids
        : [req.body.subject_ids];

    let added = 0, skipped = 0;
    for (const sid of subjectIds) {
        const subjectId = parseId(sid, "subject_id");
        await getMasterById(subjectId, "SUBJECT");

        const dup = await q(`
            SELECT id FROM erp_marks
            WHERE record_type = 'STUDENT_SUBJECT'
              AND student_id = ? AND session_id = ? AND subject_id = ?
            LIMIT 1
        `, [studentId, sessionId, subjectId]);

        if (dup.length > 0) { skipped++; continue; }

        await q(`
            INSERT INTO erp_marks (
                record_type, student_id, session_id, class_id,
                section_id, stream_id, subject_id, status, data, created_at
            ) VALUES ('STUDENT_SUBJECT', ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NOW())
        `, [
            studentId, sessionId, masterIds.class_id,
            masterIds.section_id, masterIds.stream_id, subjectId,
            safeJSONStringify({ is_optional: false, assigned_by: user.user_id })
        ]);
        added++;
    }

    await auditLog({
        action: "STUDENT_SUBJECTS_ASSIGNED", entity_type: "STUDENT_SUBJECT",
        student_id: studentId, session_id: sessionId, user,
        new_value: { class_id: masterIds.class_id, subject_ids: subjectIds, added, skipped }
    });

    return ok(res, {
        added, skipped, requested: subjectIds.length,
        student: {
            class: student.class,
            section: student.section,
            stream: student.stream
        }
    }, `${added} subject(s) assigned`);
}));

router.delete("/student-subjects/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);

    const rows = await q(
        `SELECT * FROM erp_marks WHERE id = ? AND record_type = 'STUDENT_SUBJECT' LIMIT 1`,
        [id]
    );
    if (rows.length === 0) return fail(res, "Student subject not found", 404);

    await q(`UPDATE erp_marks SET status = 'INACTIVE', updated_at = NOW() WHERE id = ?`, [id]);

    await auditLog({
        action: "STUDENT_SUBJECT_DEACTIVATED", entity_type: "STUDENT_SUBJECT",
        entity_id: id, student_id: rows[0].student_id, user, old_value: rows[0]
    });

    return ok(res, null, "Student subject deactivated");
}));

// ============================================================
// SECTION 8: EXAM TEMPLATES
// ============================================================
router.get("/exam-templates", asyncHandler(async (req, res) => {
    const templates = await q(`
        SELECT id, master_key AS template_code, name AS template_name,
               display_order, is_active, data, created_at
        FROM erp_master WHERE master_type = 'EXAM_TEMPLATE' ORDER BY display_order ASC
    `);

    const result = [];
    for (const t of templates) {
        const items = await q(`
            SELECT id, master_key AS exam_code, name AS exam_name,
                   display_order, is_active, data
            FROM erp_master
            WHERE master_type = 'EXAM_TEMPLATE_ITEM' AND parent_id = ?
            ORDER BY display_order ASC
        `, [t.id]);

        result.push({
            ...t,
            ...safeJSONParse(t.data, {}),
            is_active: !!t.is_active,
            items: items.map(i => ({
                ...i,
                ...safeJSONParse(i.data, {}),
                is_active: !!i.is_active
            }))
        });
    }
    return ok(res, result, "Exam templates fetched successfully");
}));

router.post("/exam-templates", asyncHandler(async (req, res) => {
    requireFields(req.body, ["template_name", "class_group"]);
    const user = getUserContext(req);
    const { template_name, class_group, description, items = [] } = req.body;

    const masterKey = template_name.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100);
    const existing = await getMasterByKey("EXAM_TEMPLATE", masterKey);
    if (existing) return fail(res, `Template already exists: ${masterKey}`, 409);

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('EXAM_TEMPLATE', ?, ?, ?, 1, ?, ?)
    `, [
        masterKey, template_name,
        toInt(req.body.display_order) || 1,
        safeJSONStringify({ class_group, description }),
        user.user_id
    ]);

    const templateId = result.insertId;
    let itemCount = 0;

    for (const item of items) {
        if (!item.exam_code || !item.exam_name) continue;
        await q(`
            INSERT INTO erp_master (master_type, master_key, name, parent_id, display_order, is_active, data, created_by)
            VALUES ('EXAM_TEMPLATE_ITEM', ?, ?, ?, ?, 1, ?, ?)
        `, [
            item.exam_code, item.exam_name, templateId,
            toInt(item.display_order) || itemCount + 1,
            safeJSONStringify({
                exam_type: item.exam_type || "Summative",
                default_max_marks: toInt(item.default_max_marks) || 100,
                default_pass_marks: toInt(item.default_pass_marks) || 33,
                weightage_percent: toFloatSafe(item.weightage_percent)
            }),
            user.user_id
        ]);
        itemCount++;
    }

    await auditLog({
        action: "EXAM_TEMPLATE_CREATED", entity_type: "EXAM_TEMPLATE",
        entity_id: templateId, user,
        new_value: { template_name, class_group, items_count: itemCount }
    });

    return ok(res, { id: templateId, template_code: masterKey, items: itemCount },
        "Exam template created successfully", 201);
}));

// ============================================================
// SECTION 9: EXAMS — Generate Structure & CRUD
// ============================================================
router.get("/exams", asyncHandler(async (req, res) => {
    const { session_id, class_id, status } = req.query;
    const { page, limit, offset } = parsePagination(req.query);

    const where = [`e.record_type = 'EXAM'`];
    const params = [];

    if (session_id) { where.push("e.session_id = ?"); params.push(parseId(session_id)); }
    if (class_id) { where.push("e.class_id = ?"); params.push(parseId(class_id)); }
    if (status) { where.push("e.status = ?"); params.push(status); }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const cnt = await q(`SELECT COUNT(*) AS total FROM erp_exams e ${whereSql}`, params);
    const total = cnt[0]?.total || 0;

    const rows = await q(`
        SELECT e.*,
               s.name AS session_name, s.master_key AS session_code,
               c.name AS class_name, c.master_key AS class_code,
               (SELECT COUNT(*) FROM erp_exams es
                WHERE es.record_type = 'EXAM_SUBJECT' AND es.exam_id = e.id) AS subjects_count,
               (SELECT COUNT(*) FROM erp_marks m
                WHERE m.record_type = 'MARKS' AND m.exam_id = e.id) AS marks_count
        FROM erp_exams e
        LEFT JOIN erp_master s ON s.id = e.session_id
        LEFT JOIN erp_master c ON c.id = e.class_id
        ${whereSql}
        ORDER BY e.display_order ASC, e.id ASC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const exams = rows.map(r => ({ ...r, data: safeJSONParse(r.data, {}) }));

    return ok(res, exams, "Exams fetched successfully", 200, {
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

router.get("/exams/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);

    const rows = await q(`
        SELECT e.*,
               s.name AS session_name, s.master_key AS session_code,
               c.name AS class_name, c.master_key AS class_code
        FROM erp_exams e
        LEFT JOIN erp_master s ON s.id = e.session_id
        LEFT JOIN erp_master c ON c.id = e.class_id
        WHERE e.id = ? AND e.record_type = 'EXAM' LIMIT 1
    `, [id]);

    if (rows.length === 0) return fail(res, "Exam not found", 404);

    const exam = { ...rows[0], data: safeJSONParse(rows[0].data, {}) };

    const subjects = await q(`
        SELECT es.id, es.subject_id, es.name AS subject_name,
               es.data, es.display_order, es.status,
               sub.master_key AS subject_code, sub.name AS actual_subject_name,
               sub.data AS subject_data
        FROM erp_exams es
        LEFT JOIN erp_master sub ON sub.id = es.subject_id
        WHERE es.record_type = 'EXAM_SUBJECT' AND es.exam_id = ?
        ORDER BY es.display_order ASC
    `, [id]);

    exam.subjects = subjects.map(s => ({
        ...s,
        data: safeJSONParse(s.data, {}),
        subject_data: safeJSONParse(s.subject_data, {})
    }));

    return ok(res, exam, "Exam fetched successfully");
}));

router.post("/exams/generate-structure", asyncHandler(async (req, res) => {
    requireFields(req.body, ["session_id", "class_ids", "template_id"]);
    const user = getUserContext(req);

    const sessionId = parseId(req.body.session_id, "session_id");
    const templateId = parseId(req.body.template_id, "template_id");
    const classIds = Array.isArray(req.body.class_ids)
        ? req.body.class_ids.map(c => parseId(c, "class_id"))
        : [parseId(req.body.class_ids, "class_id")];

    await getMasterById(sessionId, "SESSION");
    await getMasterById(templateId, "EXAM_TEMPLATE");

    const templateItems = await q(`
        SELECT master_key AS exam_code, name AS exam_name, display_order, data
        FROM erp_master
        WHERE master_type = 'EXAM_TEMPLATE_ITEM' AND parent_id = ? AND is_active = 1
        ORDER BY display_order ASC
    `, [templateId]);

    if (templateItems.length === 0) return fail(res, "Template has no exam items", 400);

    const created = [], skipped = [];

    for (const classId of classIds) {
        await getMasterById(classId, "CLASS");

        for (const item of templateItems) {
            const itemData = safeJSONParse(item.data, {});

            const dup = await q(`
                SELECT id FROM erp_exams
                WHERE record_type = 'EXAM' AND session_id = ? AND class_id = ? AND exam_code = ?
                LIMIT 1
            `, [sessionId, classId, item.exam_code]);

            if (dup.length > 0) {
                skipped.push({ class_id: classId, exam_code: item.exam_code, reason: "already_exists" });
                continue;
            }

            const result = await q(`
                INSERT INTO erp_exams (
                    record_type, session_id, class_id, exam_code, name, exam_type,
                    display_order, status, data, created_by
                ) VALUES ('EXAM', ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
            `, [
                sessionId, classId, item.exam_code, item.exam_name,
                itemData.exam_type || "Summative",
                item.display_order || 1,
                safeJSONStringify({
                    default_max_marks: itemData.default_max_marks || 100,
                    default_pass_marks: itemData.default_pass_marks || 33,
                    weightage_percent: itemData.weightage_percent || 0,
                    template_item_id: templateId
                }),
                user.user_id
            ]);

            created.push({
                id: result.insertId,
                class_id: classId,
                exam_code: item.exam_code,
                exam_name: item.exam_name
            });
        }
    }

    await auditLog({
        action: "EXAM_STRUCTURE_GENERATED", entity_type: "EXAM", user,
        new_value: {
            session_id: sessionId, class_ids: classIds, template_id: templateId,
            created: created.length, skipped: skipped.length
        }
    });

    return ok(res, { created, skipped, total_created: created.length },
        `Exam structure generated: ${created.length} exam(s) created`, 201);
}));

router.post("/exams/:id/subjects", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);
    requireFields(req.body, ["subject_ids"]);

    const subjectIds = Array.isArray(req.body.subject_ids)
        ? req.body.subject_ids
        : [req.body.subject_ids];

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam is locked", 400);

    let added = 0, skipped = 0;
    for (const sid of subjectIds) {
        const subjectId = parseId(sid, "subject_id");
        await getMasterById(subjectId, "SUBJECT");

        const dup = await q(`
            SELECT id FROM erp_exams
            WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
            LIMIT 1
        `, [examId, subjectId]);

        if (dup.length > 0) { skipped++; continue; }

        const maxMarks = toInt(req.body.max_marks) || safeJSONParse(exam.data, {})?.default_max_marks || 100;
        const passMarks = toInt(req.body.pass_marks) || safeJSONParse(exam.data, {})?.default_pass_marks || 33;

        const examSubjectData = {
            max_marks: maxMarks,
            pass_marks: passMarks,
            theory_max: toInt(req.body.theory_max) || maxMarks,
            practical_max: toInt(req.body.practical_max) || 0,
            internal_max: toInt(req.body.internal_max) || 0,
            project_max: toInt(req.body.project_max) || 0,
            grace_marks: toInt(req.body.grace_marks) || 0,
            weightage: toFloatSafe(req.body.weightage)
        };

        const maxOrder = await q(
            `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order 
             FROM erp_exams WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ?`,
            [examId]
        );

        const subjRow = await getMasterById(subjectId, "SUBJECT");

        await q(`
            INSERT INTO erp_exams (
                record_type, session_id, class_id, exam_id, subject_id, name,
                display_order, status, data, created_by
            ) VALUES ('EXAM_SUBJECT', ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)
        `, [
            exam.session_id, exam.class_id, examId, subjectId,
            subjRow.name, maxOrder[0].next_order,
            safeJSONStringify(examSubjectData), user.user_id
        ]);
        added++;
    }

    await auditLog({
        action: "EXAM_SUBJECTS_ADDED", entity_type: "EXAM_SUBJECT",
        exam_id: examId, user,
        new_value: { subject_ids: subjectIds, added, skipped }
    });

    return ok(res, { added, skipped, requested: subjectIds.length }, `${added} subject(s) added to exam`);
}));

router.delete("/exams/:id/subjects/:subjectId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const subjectId = parseId(req.params.subjectId, "subject_id");
    const user = getUserContext(req);

    const rows = await q(`
        SELECT * FROM erp_exams
        WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
        LIMIT 1
    `, [examId, subjectId]);

    if (rows.length === 0) return fail(res, "Exam subject not found", 404);

    const marks = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks 
         WHERE record_type = 'MARKS' AND exam_id = ? AND subject_id = ?`,
        [examId, subjectId]
    );
    if (marks[0].cnt > 0) {
        return fail(res, `Cannot remove subject: ${marks[0].cnt} marks record(s) exist`, 400);
    }

    await q(`DELETE FROM erp_exams WHERE id = ?`, [rows[0].id]);

    await auditLog({
        action: "EXAM_SUBJECT_REMOVED", entity_type: "EXAM_SUBJECT",
        entity_id: rows[0].id, exam_id: examId, subject_id: subjectId, user
    });

    return ok(res, null, "Exam subject removed");
}));

// ============================================================
// SECTION 10: MARKS ENTRY & WORKFLOW
// ============================================================
router.get("/marks-entry/:examId/:subjectId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const subjectId = parseId(req.params.subjectId, "subjectId");
    const { section_id } = req.query;

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam is locked", 400);

    const examSub = await q(`
        SELECT * FROM erp_exams
        WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
        LIMIT 1
    `, [examId, subjectId]);
    if (examSub.length === 0) return fail(res, "Subject not configured for this exam", 404);
    const examSubjectConfig = safeJSONParse(examSub[0].data, {});

    // ✅ Fetch students from Nstudent (JOIN with student-subject assignment)
    let sql = `
        SELECT ss.student_id, ss.class_id, ss.section_id, ss.stream_id,
               n.name AS student_name, n.father_name, n.mother_name, n.roll_number,
               n.student_photo_url AS photo,
               n.class AS student_class, n.section AS student_section,
               n.stream AS student_stream, n.session AS student_session,
               m.id AS marks_id, m.theory_marks, m.practical_marks,
               m.internal_marks, m.project_marks, m.total_marks, m.max_marks,
               m.grade, m.is_absent, m.absent_type, m.remarks, m.status AS marks_status
        FROM erp_marks ss
        JOIN Nstudent n ON n.student_id = ss.student_id
        LEFT JOIN erp_marks m ON m.record_type = 'MARKS'
            AND m.student_id = ss.student_id
            AND m.exam_id = ?
            AND m.subject_id = ss.subject_id
        WHERE ss.record_type = 'STUDENT_SUBJECT'
          AND ss.session_id = ?
          AND ss.class_id = ?
          AND ss.subject_id = ?
          AND ss.status = 'ACTIVE'
    `;
    const params = [examId, exam.session_id, exam.class_id, subjectId];

    if (section_id) {
        sql += ` AND ss.section_id = ?`;
        params.push(parseId(section_id, "section_id"));
    }
    sql += ` ORDER BY n.roll_number ASC, n.name ASC`;

    const students = await q(sql, params);

    return ok(res, {
        exam: {
            id: exam.id,
            exam_code: exam.exam_code,
            exam_name: exam.name,
            session_id: exam.session_id,
            class_id: exam.class_id,
            status: exam.status,
            is_locked: !!exam.is_locked
        },
        subject_config: examSubjectConfig,
        students
    }, "Marks entry data fetched successfully");
}));

router.post("/marks/save", asyncHandler(async (req, res) => {
    requireFields(req.body, ["exam_id", "subject_id", "marks"]);
    const user = getUserContext(req);

    const examId = parseId(req.body.exam_id, "exam_id");
    const subjectId = parseId(req.body.subject_id, "subject_id");
    const marksList = req.body.marks;

    if (!Array.isArray(marksList) || marksList.length === 0) {
        return fail(res, "marks array is required", 400);
    }

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam is locked", 400);
    if (exam.status === "PUBLISHED") {
        return fail(res, "Exam is published, cannot modify marks", 400);
    }

    const examSub = await q(`
        SELECT * FROM erp_exams
        WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
        LIMIT 1
    `, [examId, subjectId]);
    if (examSub.length === 0) return fail(res, "Subject not configured for this exam", 400);

    const cfg = safeJSONParse(examSub[0].data, {});
    const theoryMax = toFloatSafe(cfg.theory_max) || 0;
    const practicalMax = toFloatSafe(cfg.practical_max) || 0;
    const internalMax = toFloatSafe(cfg.internal_max) || 0;
    const projectMax = toFloatSafe(cfg.project_max) || 0;
    const maxMarks = toFloatSafe(cfg.max_marks) || 100;

    const saved = [], failed = [];

    for (const item of marksList) {
        try {
            const studentId = String(item.student_id || "").trim();
            if (!studentId) throw new Error("student_id missing");

            // ✅ CRITICAL: Verify student is assigned this subject
            const assigned = await q(`
                SELECT id FROM erp_marks
                WHERE record_type = 'STUDENT_SUBJECT'
                  AND student_id = ? AND session_id = ? AND class_id = ?
                  AND subject_id = ? AND status = 'ACTIVE'
                LIMIT 1
            `, [studentId, exam.session_id, exam.class_id, subjectId]);

            if (assigned.length === 0) {
                throw new Error(`Student ${studentId} not assigned to this subject`);
            }

            const theory = toDecimal(item.theory);
            const practical = toDecimal(item.practical);
            const internal = toDecimal(item.internal);
            const project = toDecimal(item.project);
            const absentType = item.absent_type || "Present";

            if (!ABSENT_TYPES.includes(absentType)) {
                throw new Error(`Invalid absent_type: ${absentType}`);
            }

            if (theory !== null && (theory < 0 || theory > theoryMax)) {
                throw new Error(`Theory must be 0-${theoryMax}`);
            }
            if (practical !== null && (practical < 0 || practical > practicalMax)) {
                throw new Error(`Practical must be 0-${practicalMax}`);
            }
            if (internal !== null && (internal < 0 || internal > internalMax)) {
                throw new Error(`Internal must be 0-${internalMax}`);
            }
            if (project !== null && (project < 0 || project > projectMax)) {
                throw new Error(`Project must be 0-${projectMax}`);
            }

            let total = 0;
            const isAbsent = absentType !== "Present";
            if (!isAbsent) {
                total = (theory || 0) + (practical || 0) + (internal || 0) + (project || 0);
            }

            const pct = maxMarks > 0 ? (total / maxMarks) * 100 : 0;
            const grade = await calculateGrade(pct);

            const existing = await q(`
                SELECT id, theory_marks, practical_marks, internal_marks, project_marks,
                       total_marks, status
                FROM erp_marks
                WHERE record_type = 'MARKS'
                  AND student_id = ? AND exam_id = ? AND subject_id = ?
                LIMIT 1
            `, [studentId, examId, subjectId]);

            const remarks = trimStr(item.remarks, 500);

            if (existing.length > 0) {
                if (["VERIFIED", "FINALIZED", "PUBLISHED"].includes(existing[0].status)) {
                    throw new Error(`Marks already ${existing[0].status}, cannot edit`);
                }

                await q(`
                    UPDATE erp_marks
                    SET theory_marks = ?, practical_marks = ?, internal_marks = ?, project_marks = ?,
                        total_marks = ?, max_marks = ?, grade = ?,
                        is_absent = ?, absent_type = ?, remarks = ?,
                        status = 'DRAFT', entered_by = ?, updated_at = NOW()
                    WHERE id = ?
                `, [
                    theory, practical, internal, project,
                    total, maxMarks, grade,
                    isAbsent ? 1 : 0, absentType, remarks,
                    user.user_id, existing[0].id
                ]);

                await auditLog({
                    action: "MARKS_UPDATED", entity_type: "MARKS",
                    entity_id: existing[0].id,
                    student_id: studentId, session_id: exam.session_id,
                    exam_id: examId, subject_id: subjectId, user,
                    old_value: existing[0],
                    new_value: { theory, practical, internal, project, total, grade, absentType }
                });
            } else {
                const result = await q(`
                    INSERT INTO erp_marks (
                        record_type, student_id, session_id, class_id,
                        section_id, stream_id, exam_id, subject_id,
                        theory_marks, practical_marks, internal_marks, project_marks,
                        total_marks, max_marks, grade, is_absent, absent_type, remarks,
                        status, entered_by, created_at
                    ) VALUES ('MARKS', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())
                `, [
                    studentId, exam.session_id, exam.class_id,
                    examId, subjectId,
                    theory, practical, internal, project,
                    total, maxMarks, grade, isAbsent ? 1 : 0, absentType, remarks,
                    user.user_id
                ]);

                await auditLog({
                    action: "MARKS_CREATED", entity_type: "MARKS",
                    entity_id: result.insertId,
                    student_id: studentId, session_id: exam.session_id,
                    exam_id: examId, subject_id: subjectId, user,
                    new_value: { theory, practical, internal, project, total, grade }
                });
            }

            saved.push({ student_id: studentId, total, grade });
        } catch (err) {
            failed.push({ student_id: item.student_id, error: err.message });
        }
    }

    if (saved.length > 0 && exam.status === "DRAFT") {
        await q(`UPDATE erp_exams SET status = 'IN_PROGRESS' WHERE id = ?`, [examId]);
    }

    return ok(res, {
        saved_count: saved.length,
        failed_count: failed.length,
        saved, failed
    }, `${saved.length} marks saved, ${failed.length} failed`);
}));

router.post("/marks/submit", asyncHandler(async (req, res) => {
    requireFields(req.body, ["exam_id", "subject_id"]);
    const user = getUserContext(req);

    const examId = parseId(req.body.exam_id, "exam_id");
    const subjectId = parseId(req.body.subject_id, "subject_id");

    const result = await q(`
        UPDATE erp_marks
        SET status = 'SUBMITTED', updated_at = NOW()
        WHERE record_type = 'MARKS'
          AND exam_id = ? AND subject_id = ?
          AND status = 'DRAFT'
    `, [examId, subjectId]);

    await auditLog({
        action: "MARKS_SUBMITTED", entity_type: "MARKS",
        exam_id: examId, subject_id: subjectId, user,
        new_value: { submitted_count: result.affectedRows }
    });

    return ok(res, { submitted: result.affectedRows }, `${result.affectedRows} marks submitted`);
}));

router.post("/marks/verify", asyncHandler(async (req, res) => {
    requireFields(req.body, ["exam_id", "subject_id"]);
    const user = getUserContext(req);

    const examId = parseId(req.body.exam_id, "exam_id");
    const subjectId = parseId(req.body.subject_id, "subject_id");

    const result = await q(`
        UPDATE erp_marks
        SET status = 'VERIFIED', verified_by = ?, verified_at = NOW(), updated_at = NOW()
        WHERE record_type = 'MARKS'
          AND exam_id = ? AND subject_id = ?
          AND status = 'SUBMITTED'
    `, [user.user_id, examId, subjectId]);

    await auditLog({
        action: "MARKS_VERIFIED", entity_type: "MARKS",
        exam_id: examId, subject_id: subjectId, user,
        new_value: { verified_count: result.affectedRows }
    });

    return ok(res, { verified: result.affectedRows }, `${result.affectedRows} marks verified`);
}));

router.post("/marks/return-for-correction", asyncHandler(async (req, res) => {
    requireFields(req.body, ["exam_id", "subject_id", "reason"]);
    const user = getUserContext(req);

    const examId = parseId(req.body.exam_id, "exam_id");
    const subjectId = parseId(req.body.subject_id, "subject_id");
    const reason = trimStr(req.body.reason, 500);

    const result = await q(`
        UPDATE erp_marks
        SET status = 'DRAFT',
            remarks = CONCAT(COALESCE(remarks, ''), ' | RETURNED: ', ?),
            updated_at = NOW()
        WHERE record_type = 'MARKS'
          AND exam_id = ? AND subject_id = ?
          AND status IN ('SUBMITTED', 'VERIFIED')
    `, [reason, examId, subjectId]);

    await auditLog({
        action: "MARKS_REJECTED", entity_type: "MARKS",
        exam_id: examId, subject_id: subjectId, user,
        reason, new_value: { returned_count: result.affectedRows }
    });

    return ok(res, { returned: result.affectedRows }, `${result.affectedRows} marks returned for correction`);
}));

// ============================================================
// SECTION 11: RESULT FINALIZATION
// ============================================================
router.post("/exams/:id/finalize", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam already finalized", 400);

    const pending = await q(`
        SELECT COUNT(*) AS cnt FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
          AND status NOT IN ('VERIFIED', 'FINALIZED')
    `, [examId]);

    if (pending[0].cnt > 0) {
        return fail(res, `${pending[0].cnt} marks are not verified yet`, 400);
    }

    // Get all distinct students
    const students = await q(`
        SELECT DISTINCT student_id FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
    `, [examId]);

    let snapshots = 0;
    for (const s of students) {
        try {
            await snapshotMarks({
                student_id: s.student_id,
                session_id: exam.session_id,
                exam_id: examId,
                reason: "FINALIZED",
                user
            });
            await snapshotResult({
                student_id: s.student_id,
                session_id: exam.session_id,
                class_id: exam.class_id,
                exam_id: examId,
                result_type: "EXAM",
                reason: "FINALIZED",
                user
            });
            snapshots++;
        } catch (err) {
            log.error("Snapshot failed", { student_id: s.student_id, error: err.message });
        }
    }

    await q(`
        UPDATE erp_exams
        SET status = 'FINALIZED', is_locked = 1,
            updated_by = ?, updated_at = NOW()
        WHERE id = ?
    `, [user.user_id, examId]);

    await q(`
        UPDATE erp_marks
        SET status = 'FINALIZED', finalized_by = ?, finalized_at = NOW(), updated_at = NOW()
        WHERE record_type = 'MARKS' AND exam_id = ? AND status = 'VERIFIED'
    `, [user.user_id, examId]);

    await auditLog({
        action: "RESULT_FINALIZED", entity_type: "EXAM",
        entity_id: examId, exam_id: examId, user,
        new_value: { snapshots, total_students: students.length }
    });

    return ok(res, { snapshots, total_students: students.length }, "Exam finalized successfully");
}));

router.post("/exams/:id/unlock", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);
    requireFields(req.body, ["reason"]);
    const reason = trimStr(req.body.reason, 500);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.status === "PUBLISHED") {
        return fail(res, "Cannot unlock published exam. Unpublish first.", 400);
    }

    await q(`
        UPDATE erp_exams
        SET status = 'VERIFIED', is_locked = 0, updated_by = ?, updated_at = NOW()
        WHERE id = ?
    `, [user.user_id, examId]);

    await q(`
        UPDATE erp_marks
        SET status = 'VERIFIED', updated_at = NOW()
        WHERE record_type = 'MARKS' AND exam_id = ? AND status = 'FINALIZED'
    `, [examId]);

    await auditLog({
        action: "RESULT_UNLOCKED", entity_type: "EXAM",
        entity_id: examId, exam_id: examId, user, reason,
        old_value: { status: exam.status }, new_value: { status: "VERIFIED" }
    });

    return ok(res, null, "Exam unlocked successfully");
}));

// ============================================================
// SECTION 12: PUBLISH / UNPUBLISH
// ============================================================
router.post("/exams/:id/publish", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);
    const { result_date } = req.body;

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.status !== "FINALIZED") {
        return fail(res, "Only finalized exams can be published", 400);
    }

    await q(`
        UPDATE erp_exams
        SET status = 'PUBLISHED', result_date = COALESCE(?, result_date),
            updated_by = ?, updated_at = NOW()
        WHERE id = ?
    `, [result_date || null, user.user_id, examId]);

    await q(`
        UPDATE erp_marks
        SET status = 'PUBLISHED', updated_at = NOW()
        WHERE record_type = 'MARKS' AND exam_id = ? AND status = 'FINALIZED'
    `, [examId]);

    await auditLog({
        action: "RESULT_PUBLISHED", entity_type: "EXAM",
        entity_id: examId, exam_id: examId, user,
        new_value: { result_date }
    });

    return ok(res, { result_date }, "Exam published successfully");
}));

router.post("/exams/:id/unpublish", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);

    await q(`
        UPDATE erp_exams
        SET status = 'FINALIZED', updated_by = ?, updated_at = NOW()
        WHERE id = ? AND record_type = 'EXAM'
    `, [user.user_id, examId]);

    await q(`
        UPDATE erp_marks
        SET status = 'FINALIZED', updated_at = NOW()
        WHERE record_type = 'MARKS' AND exam_id = ? AND status = 'PUBLISHED'
    `, [examId]);

    await auditLog({
        action: "RESULT_UNPUBLISHED", entity_type: "EXAM",
        entity_id: examId, exam_id: examId, user
    });

    return ok(res, null, "Exam unpublished successfully");
}));

// ============================================================
// ✅ SECTION 13: STUDENT SELF-SERVICE (PERMANENT RESULTS)
// ============================================================
/**
 * GET /student/:studentId/permanent
 * Fetches complete, permanent results for a student.
 * - Student data comes from Nstudent (single source of truth)
 * - Results come from erp_results_backup (permanent snapshots)
 * - Auto-snapshots any newly published exam
 * - Only admin can delete (via /admin/result/:resultId)
 */
router.get("/student/:studentId/permanent", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.query;

    if (!studentId || studentId.trim() === "") {
        return fail(res, "Student ID is required", 400);
    }

    const sid = studentId.trim();

    // ✅ STEP 1: Fetch student from Nstudent
    let student;
    try {
        student = await getStudentFromNstudent(sid);
    } catch (err) {
        return fail(res, err.message, 404);
    }

    if (student.status && student.status.toLowerCase() === "inactive") {
        return fail(res, "Student account is inactive. Contact school office.", 403);
    }

    // ✅ STEP 2: Resolve master IDs from Nstudent values
    const masterIds = await resolveMasterIdsFromStudent(student, session_id);

    // ✅ STEP 3: Auto-snapshot any PUBLISHED exam not yet in backup
    if (masterIds.class_id) {
        try {
            const publishedExams = await q(`
                SELECT id, session_id, class_id, exam_code, name AS exam_name
                FROM erp_exams
                WHERE record_type = 'EXAM'
                  AND status = 'PUBLISHED'
                  AND class_id = ?
                  ${session_id ? "AND session_id = ?" : ""}
            `, session_id
                ? [masterIds.class_id, parseId(session_id)]
                : [masterIds.class_id]
            );

            for (const exam of publishedExams) {
                const existing = await q(`
                    SELECT id FROM erp_results_backup
                    WHERE student_id = ? AND exam_id = ? AND result_type = 'EXAM'
                    LIMIT 1
                `, [sid, exam.id]);

                if (existing.length === 0) {
                    log.info("Auto-snapshotting published exam", { sid, examId: exam.id });
                    await snapshotMarks({
                        student_id: sid,
                        session_id: exam.session_id,
                        exam_id: exam.id,
                        reason: "AUTO_ON_VIEW",
                        user: { user_id: "SYSTEM", user_name: "System", user_role: "SYSTEM" }
                    });
                    await snapshotResult({
                        student_id: sid,
                        session_id: exam.session_id,
                        class_id: exam.class_id,
                        exam_id: exam.id,
                        result_type: "EXAM",
                        reason: "AUTO_ON_VIEW",
                        user: { user_id: "SYSTEM", user_name: "System", user_role: "SYSTEM" }
                    });
                }
            }
        } catch (snapshotErr) {
            log.warn("Auto-snapshot warning (non-fatal)", {
                error: snapshotErr.message, studentId: sid
            });
        }
    }

    // ✅ STEP 4: Fetch permanent results
    let sql = `
        SELECT * FROM erp_results_backup
        WHERE student_id = ? AND result_type = 'EXAM'
    `;
    const params = [sid];
    if (session_id) {
        sql += " AND session_id = ?";
        params.push(parseId(session_id));
    }
    sql += " ORDER BY session_id DESC, snapshot_at DESC";

    const resultsRows = await q(sql, params);

    // ✅ STEP 5: Attach subject-wise marks from backup
    const results = [];
    for (const r of resultsRows) {
        const marksRows = await q(`
            SELECT subject_id, subject_name,
                   theory_marks, practical_marks, internal_marks, project_marks,
                   total_marks, max_marks, grade,
                   is_absent, absent_type, remarks
            FROM erp_marks_backup
            WHERE student_id = ? AND session_id = ? AND exam_id = ?
            ORDER BY subject_id ASC
        `, [sid, r.session_id, r.exam_id]);

        results.push({
            result_id: r.id,
            exam_id: r.exam_id,
            exam_name: r.exam_name,
            session_id: r.session_id,
            session_name: r.session_name,
            class_name: r.class_name,
            section_name: r.section_name,
            stream: r.stream,
            result_type: r.result_type,
            grand_total: r.grand_total,
            max_total: r.max_total,
            percentage: r.percentage,
            overall_grade: r.overall_grade,
            result_status: r.result_status,
            failed_subjects: safeJSONParse(r.failed_subjects, []),
            subject_wise_marks: marksRows,
            subject_count: marksRows.length,
            remarks: r.remarks,
            snapshot_at: r.snapshot_at,
            snapshot_reason: r.snapshot_reason
        });
    }

    log.info("Permanent result fetched", {
        studentId: sid,
        total_results: results.length
    });

    return ok(res, {
        student: {
            student_id: student.student_id,
            admission_number: student.admission_number,
            apaar_id: student.apaar_id,
            name: student.name,
            father_name: student.father_name,
            mother_name: student.mother_name,
            dob: student.dob,
            gender: student.gender,
            category: student.category,
            class: student.class,
            section: student.section,
            stream: student.stream,
            session: student.session,
            roll_number: student.roll_number,
            photo: student.photo,
            signature: student.signature_url,
            mobile: student.mobile_number,
            email: student.email_id,
            address: student.address,
            village: student.village,
            district: student.district,
            state: student.state
        },
        results,
        total_results: results.length,
        is_permanent: true
    }, results.length > 0
        ? "Permanent results loaded successfully"
        : "No published result available yet"
    );
}));

// ============================================================
// SECTION 14: ADMIN — DELETE PERMANENT RESULT
// ============================================================
router.delete("/admin/result/:resultId", asyncHandler(async (req, res) => {
    const resultId = parseId(req.params.resultId, "resultId");
    const user = getUserContext(req);

    const rows = await q(
        `SELECT * FROM erp_results_backup WHERE id = ? LIMIT 1`,
        [resultId]
    );
    if (rows.length === 0) return fail(res, "Result not found", 404);

    const result = rows[0];

    await q(`DELETE FROM erp_results_backup WHERE id = ?`, [resultId]);
    await q(
        `DELETE FROM erp_marks_backup 
         WHERE student_id = ? AND session_id = ? AND exam_id = ?`,
        [result.student_id, result.session_id, result.exam_id]
    );

    await auditLog({
        action: "RESULT_SNAPSHOT_DELETED", entity_type: "RESULT",
        entity_id: resultId, student_id: result.student_id,
        session_id: result.session_id, exam_id: result.exam_id,
        user, old_value: result, reason: req.body.reason || "Admin manual delete"
    });

    return ok(res, null, "Result deleted permanently by admin");
}));

router.delete("/admin/student/:studentId/all-results", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const user = getUserContext(req);
    const sid = studentId.trim();

    const cnt = await q(
        `SELECT COUNT(*) AS total FROM erp_results_backup WHERE student_id = ?`,
        [sid]
    );
    if (cnt[0].total === 0) return fail(res, `No results found for: ${sid}`, 404);

    const delResults = await q(`DELETE FROM erp_results_backup WHERE student_id = ?`, [sid]);
    const delMarks = await q(`DELETE FROM erp_marks_backup WHERE student_id = ?`, [sid]);

    await auditLog({
        action: "ALL_RESULTS_DELETED", entity_type: "RESULT",
        student_id: sid, user,
        reason: req.body.reason || "Admin bulk delete",
        old_value: {
            results_deleted: delResults.affectedRows,
            marks_deleted: delMarks.affectedRows
        }
    });

    return ok(res, {
        results_deleted: delResults.affectedRows,
        marks_deleted: delMarks.affectedRows
    }, `All results deleted for student ${sid}`);
}));

// ============================================================
// SECTION 15: STUDENT RESULTS (Admin view - from backup)
// ============================================================
router.get("/student/:studentId/results", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.query;

    const student = await getStudentFromNstudent(studentId);

    let sql = `
        SELECT * FROM erp_results_backup
        WHERE student_id = ? AND result_type = 'EXAM'
    `;
    const params = [studentId];
    if (session_id) { sql += " AND session_id = ?"; params.push(parseId(session_id)); }
    sql += " ORDER BY session_id DESC, exam_id ASC";

    const results = await q(sql, params);

    const formatted = results.map(r => ({
        id: r.id,
        session_id: r.session_id,
        session_name: r.session_name,
        exam_id: r.exam_id,
        exam_name: r.exam_name,
        class_name: r.class_name,
        grand_total: r.grand_total,
        max_total: r.max_total,
        percentage: r.percentage,
        overall_grade: r.overall_grade,
        result_status: r.result_status,
        failed_subjects: safeJSONParse(r.failed_subjects, []),
        subject_wise_marks: safeJSONParse(r.subject_wise_marks, []),
        snapshot_at: r.snapshot_at
    }));

    return ok(res, {
        student: {
            student_id: student.student_id,
            name: student.name,
            father_name: student.father_name,
            class: student.class,
            section: student.section,
            stream: student.stream,
            session: student.session,
            roll_number: student.roll_number,
            photo: student.photo
        },
        results: formatted,
        total: formatted.length
    }, "Student results fetched successfully");
}));

// ============================================================
// SECTION 16: PUBLIC APIs
// ============================================================
router.post("/public/search", asyncHandler(async (req, res) => {
    requireFields(req.body, ["student_id", "dob"]);
    const { student_id, dob, session_id } = req.body;

    const students = await q(`
        SELECT student_id, name, father_name, mother_name, dob,
               class, section, stream, session, roll_number,
               student_photo_url AS photo
        FROM Nstudent
        WHERE student_id = ? AND DATE(dob) = DATE(?)
        LIMIT 1
    `, [student_id, dob]);

    if (students.length === 0) {
        return fail(res, "No student found with the provided details", 404);
    }

    const student = students[0];

    let sql = `
        SELECT * FROM erp_results_backup
        WHERE student_id = ? AND result_type = 'EXAM'
    `;
    const params = [student_id];
    if (session_id) { sql += " AND session_id = ?"; params.push(parseId(session_id)); }
    sql += " ORDER BY session_id DESC, exam_id ASC";

    const results = await q(sql, params);

    const formatted = results.map(r => ({
        exam_name: r.exam_name,
        session_name: r.session_name,
        class_name: r.class_name,
        section_name: r.section_name,
        stream: r.stream,
        grand_total: r.grand_total,
        max_total: r.max_total,
        percentage: r.percentage,
        overall_grade: r.overall_grade,
        result_status: r.result_status,
        subject_wise_marks: safeJSONParse(r.subject_wise_marks, []),
        failed_subjects: safeJSONParse(r.failed_subjects, []),
        snapshot_at: r.snapshot_at
    }));

    return ok(res, {
        student: {
            student_id: student.student_id,
            name: student.name,
            father_name: student.father_name,
            class: student.class,
            section: student.section,
            stream: student.stream,
            roll_number: student.roll_number,
            photo: student.photo
        },
        results: formatted,
        total: formatted.length
    }, "Results fetched successfully");
}));

router.get("/public/verify/:studentId/:examId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const examId = parseId(req.params.examId, "examId");

    const rows = await q(`
        SELECT student_name, roll_number, class_name, section_name, stream,
               session_name, exam_name, result_status, percentage,
               overall_grade, snapshot_at
        FROM erp_results_backup
        WHERE student_id = ? AND exam_id = ? AND result_type = 'EXAM'
        LIMIT 1
    `, [studentId, examId]);

    if (rows.length === 0) {
        return ok(res, {
            verified: false,
            message: "No result found for verification"
        }, "Verification failed");
    }

    const r = rows[0];
    return ok(res, {
        verified: true,
        school_name: "GSSS Shilla",
        student_name: r.student_name,
        roll_number: r.roll_number,
        class: r.class_name,
        section: r.section_name,
        stream: r.stream,
        session: r.session_name,
        exam: r.exam_name,
        result_status: r.result_status,
        percentage: r.percentage,
        grade: r.overall_grade,
        verified_at: r.snapshot_at
    }, "Result verified successfully");
}));

// ============================================================
// SECTION 17: DASHBOARD & ANALYTICS
// ============================================================
router.get("/dashboard/stats", asyncHandler(async (req, res) => {
    const { session_id } = req.query;
    const sessionFilter = session_id ? ` AND e.session_id = ${parseId(session_id)}` : "";

    const overall = await q(`
        SELECT
            (SELECT COUNT(DISTINCT student_id) FROM erp_marks 
             WHERE record_type = 'STUDENT_SUBJECT' ${session_id ? `AND session_id = ${parseId(session_id)}` : ""}) AS total_students,
            (SELECT COUNT(*) FROM erp_exams WHERE record_type = 'EXAM' ${sessionFilter}) AS total_exams,
            (SELECT COUNT(*) FROM erp_exams WHERE record_type = 'EXAM' AND status = 'PUBLISHED' ${sessionFilter}) AS published_exams,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' ${session_id ? `AND session_id = ${parseId(session_id)}` : ""}) AS total_marks,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' AND status = 'DRAFT' ${session_id ? `AND session_id = ${parseId(session_id)}` : ""}) AS draft_marks,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' AND status = 'VERIFIED' ${session_id ? `AND session_id = ${parseId(session_id)}` : ""}) AS verified_marks,
            (SELECT COUNT(*) FROM erp_results_backup WHERE result_type = 'EXAM' AND result_status = 'Pass' ${session_id ? `AND session_id = ${parseId(session_id)}` : ""}) AS pass_count,
            (SELECT COUNT(*) FROM erp_results_backup WHERE result_type = 'EXAM' AND result_status = 'Fail' ${session_id ? `AND session_id = ${parseId(session_id)}` : ""}) AS fail_count
    `);

    return ok(res, { overall: overall[0] || {} }, "Dashboard stats fetched successfully");
}));

router.get("/analytics/exam/:examId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");

    const subjectStats = await q(`
        SELECT
            m.subject_id,
            sub.name AS subject_name,
            COUNT(*) AS total_students,
            AVG(m.total_marks) AS avg_marks,
            MAX(m.total_marks) AS highest,
            MIN(m.total_marks) AS lowest,
            SUM(CASE WHEN m.absent_type = 'Present' AND m.total_marks >= 
                COALESCE((SELECT JSON_EXTRACT(es.data, '$.pass_marks') FROM erp_exams es
                          WHERE es.record_type = 'EXAM_SUBJECT' AND es.exam_id = ? AND es.subject_id = m.subject_id LIMIT 1), 33)
                THEN 1 ELSE 0 END) AS pass_count
        FROM erp_marks m
        LEFT JOIN erp_master sub ON sub.id = m.subject_id
        WHERE m.record_type = 'MARKS' AND m.exam_id = ?
        GROUP BY m.subject_id, sub.name
    `, [examId, examId]);

    const gradeDist = await q(`
        SELECT grade, COUNT(*) AS count
        FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
        GROUP BY grade
    `, [examId]);

    const statusDist = await q(`
        SELECT result_status, COUNT(*) AS count
        FROM erp_results_backup
        WHERE exam_id = ? AND result_type = 'EXAM'
        GROUP BY result_status
    `, [examId]);

    return ok(res, {
        subject_stats: subjectStats,
        grade_distribution: gradeDist,
        result_status_distribution: statusDist
    }, "Analytics fetched successfully");
}));

// ============================================================
// SECTION 18: AUDIT LOGS
// ============================================================
router.get("/audit-logs", asyncHandler(async (req, res) => {
    const { action, student_id, exam_id, entity_type, from_date, to_date } = req.query;
    const { page, limit, offset } = parsePagination(req.query);

    const where = [];
    const params = [];

    if (action) { where.push("action = ?"); params.push(action); }
    if (student_id) { where.push("student_id = ?"); params.push(student_id); }
    if (exam_id) { where.push("exam_id = ?"); params.push(parseId(exam_id)); }
    if (entity_type) { where.push("entity_type = ?"); params.push(entity_type); }
    if (from_date) { where.push("created_at >= ?"); params.push(from_date); }
    if (to_date) { where.push("created_at <= ?"); params.push(to_date); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const cnt = await q(`SELECT COUNT(*) AS total FROM erp_audit_logs ${whereSql}`, params);
    const total = cnt[0]?.total || 0;

    const rows = await q(`
        SELECT * FROM erp_audit_logs
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const logs = rows.map(r => ({
        ...r,
        old_value: safeJSONParse(r.old_value),
        new_value: safeJSONParse(r.new_value)
    }));

    return ok(res, logs, "Audit logs fetched successfully", 200, {
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
router.use((err, req, res, next) => {
    log.error("Route error", {
        path: req.originalUrl,
        method: req.method,
        error: err.message
    });
    if (res.headersSent) return next(err);
    return fail(res, err.message || "Internal server error", 500);
});

module.exports = router;
