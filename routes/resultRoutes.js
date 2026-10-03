// ============================================================
// SCHOOL EXAMINATION & RESULT MANAGEMENT SYSTEM
// resultRoutes.js — COMPLETE UPDATED VERSION
// ============================================================
// 
// CHANGELOG (Latest):
// - FIXED: Subject force delete with ?force=true
// - FIXED: Student subject allocation (manual only, no auto)
// - ADDED: Bulk assign subjects route
// - ADDED: Debug endpoint for subject allocation
// - FIXED: Class/section/stream resolvers (tolerant matching)
// - FIXED: JSON null vs SQL NULL comparisons
// - FIXED: Validation errors return proper HTTP status
//
// ============================================================

const express = require("express");
const router = express.Router();
const db = require("../config/db");





// ============================================================
// SECTION 0: CORE UTILITIES
// ============================================================

class HttpError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// FIX: works with both mysql2/promise ([rows, fields]) and wrappers that return rows directly
const q = async (sql, params = []) => {
    const r = await db.query(sql, params);
    if (Array.isArray(r) && r.length === 2 &&
        (Array.isArray(r[0]) || (r[0] && typeof r[0] === "object" && "affectedRows" in r[0]))) {
        return r[0];
    }
    return r;
};

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
// SECTION 0.1: CONSTANTS
// ============================================================

const ABSENT_TYPES = ["Present", "Absent", "Medical", "Not_Appeared", "Withheld"];
const VALID_CLASS_GROUPS = ["PRIMARY", "MIDDLE", "SECONDARY", "SENIOR"];
const VALID_SUBJECT_TYPES = ["Core", "Elective", "Optional", "Language", "Vocational"];
const VALID_COMPONENT_TYPES = [
    "Theory", "Theory+Practical", "Theory+Internal",
    "Theory+Practical+Internal", "Practical", "Internal", "Project"
];
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 500;
const ADMIN_ROLES = ["ADMIN", "SUPERADMIN", "SUPER_ADMIN", "PRINCIPAL", "EXAM_ADMIN"];





// ============================================================
// SECTION 0.2: VALIDATION HELPERS
// ============================================================

function requireFields(body, fields) {
    const missing = [];
    for (const f of fields) {
        if (body[f] === undefined || body[f] === null || String(body[f]).trim() === "") {
            missing.push(f);
        }
    }
    if (missing.length > 0) throw new HttpError(`Missing required: ${missing.join(", ")}`, 400);
}

function parseId(raw, fieldName = "id") {
    const id = parseInt(raw, 10);
    if (isNaN(id) || id <= 0) throw new HttpError(`Invalid ${fieldName}`, 400);
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
    try { return JSON.parse(raw); } catch { return fallback; }
}

function safeJSONStringify(obj) {
    if (obj === null || obj === undefined) return null;
    try { return JSON.stringify(obj); } catch { return null; }
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

// strict mark parser
function parseMark(raw, label, max) {
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
    if (n < 0 || n > max) throw new Error(`${label} must be between 0 and ${max}`);
    return n;
}

// default pass mark = 33% of component max when not supplied
function defPass(max, pass) {
    const m = parseInt(max) || 0;
    const p = parseInt(pass) || 0;
    if (p > 0) return Math.min(p, m || p);
    return m > 0 ? Math.ceil(m * 0.33) : 0;
}

// FIX: JSON helper. JSON_EXTRACT returns JSON values which break comparisons.
// This returns plain string or SQL NULL.
const JX = (col, path) => `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${col}, '${path}')), 'null')`;





// ============================================================
// SECTION 0.3: AUTH HELPERS
// ============================================================

// Set ENFORCE_ROLES=true in .env once auth middleware populates req.user.role
const requireRole = (...roles) => (req, res, next) => {
    if (process.env.ENFORCE_ROLES !== "true") return next();
    const u = req.user || req.admin;
    if (!u) return fail(res, "Authentication required", 401);
    const role = String(u.role || "").toUpperCase();
    if (!roles.includes(role)) return fail(res, "You are not allowed to perform this action", 403);
    next();
};

const isStaff = (req) => !!(req.user || req.admin);





// ============================================================
// SECTION 0.4: USER CONTEXT (for audit logs)
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
// SECTION 0.5: AUDIT LOGGING
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
// SECTION 0.6: MASTER HELPERS
// ============================================================

async function getMasterById(id, expectedType = null) {
    const rows = await q(`SELECT * FROM erp_master WHERE id = ? LIMIT 1`, [id]);
    if (rows.length === 0) throw new HttpError(`Master record not found: ${id}`, 404);
    if (expectedType && rows[0].master_type !== expectedType) {
        throw new HttpError(`Expected ${expectedType}, got ${rows[0].master_type}`, 400);
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

async function getStudentFromNstudent(studentId) {
    const rows = await q(`
        SELECT id, student_id, admission_number, apaar_id,
            name, father_name, mother_name, dob, gender, category,
            class, section, stream, session, roll_number,
            student_photo_url AS photo, signature_url, aadhar_number,
            mobile_number, email_id, status,
            address, village, post_office, tehsil, district, state, pincode
        FROM Nstudent
        WHERE student_id = ?
        LIMIT 1
    `, [studentId]);

    if (rows.length === 0) throw new HttpError(`Student not found: ${studentId}`, 404);
    return rows[0];
}





// ============================================================
// SECTION 0.7: TOLERANT CLASS/SECTION/STREAM RESOLVERS
// ============================================================
// FIX: Nstudent.class may be "10", "Class 10", "X" etc.
// These helpers try multiple variations to find the right master record.

/**
 * Resolve class row from raw class string
 * Handles: "10", "Class 10", "CLASS-10", "X", "x", "010"
 */
async function resolveClassRow(rawClass) {
    const raw = String(rawClass ?? "").trim();
    if (!raw) return null;

    // Strip "class" prefix and clean
    const stripped = raw.replace(/^class\s*[-:]?\s*/i, "").trim();

    // Build variations to try
    const variations = [
        raw,
        stripped,
        stripped.toUpperCase(),
        stripped.toLowerCase(),
        `Class ${stripped}`,
        `CLASS ${stripped}`,
        `Class-${stripped}`
    ].filter(Boolean);

    const uniqueVariations = [...new Set(variations)];

    // 1. Exact master_key match
    for (const v of uniqueVariations) {
        const r = await q(
            `SELECT * FROM erp_master WHERE master_type = 'CLASS' AND master_key = ? LIMIT 1`,
            [v]
        );
        if (r.length > 0) return r[0];
    }

    // 2. Case-insensitive master_key match
    for (const v of uniqueVariations) {
        const r = await q(
            `SELECT * FROM erp_master WHERE master_type = 'CLASS' AND LOWER(master_key) = LOWER(?) LIMIT 1`,
            [v]
        );
        if (r.length > 0) return r[0];
    }

    // 3. Name match
    for (const v of uniqueVariations) {
        const r = await q(
            `SELECT * FROM erp_master 
             WHERE master_type = 'CLASS' 
               AND (LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?))
             LIMIT 1`,
            [v, `Class ${v}`]
        );
        if (r.length > 0) return r[0];
    }

    // 4. Fallback: partial number match
    const numMatch = stripped.match(/\d+/);
    if (numMatch) {
        const num = numMatch[0];
        const r = await q(
            `SELECT * FROM erp_master 
             WHERE master_type = 'CLASS' 
               AND (master_key = ? OR master_key LIKE ? OR name LIKE ?)
             LIMIT 1`,
            [num, `%${num}%`, `%${num}%`]
        );
        if (r.length > 0) return r[0];
    }

    return null;
}

/**
 * Resolve section ID from raw section string for a given class
 * Handles: "A", "a", "Section A"
 */
async function resolveSectionId(classId, rawSection) {
    const raw = String(rawSection ?? "").trim();
    if (!raw) return null;

    const variations = [raw, raw.toUpperCase(), raw.toLowerCase()];
    const uniqueVariations = [...new Set(variations)];

    // 1. Exact match
    for (const v of uniqueVariations) {
        const rows = await q(
            `SELECT id FROM erp_master 
             WHERE master_type = 'SECTION' AND parent_id = ? AND master_key = ?
             LIMIT 1`,
            [classId, v]
        );
        if (rows.length > 0) return rows[0].id;
    }

    // 2. Case-insensitive
    for (const v of uniqueVariations) {
        const rows = await q(
            `SELECT id FROM erp_master 
             WHERE master_type = 'SECTION' AND parent_id = ? 
               AND LOWER(master_key) = LOWER(?)
             LIMIT 1`,
            [classId, v]
        );
        if (rows.length > 0) return rows[0].id;
    }

    return null;
}

/**
 * Resolve stream ID from raw stream string
 * Handles: "SCI", "Science", "science"
 */
async function resolveStreamId(rawStream) {
    const raw = String(rawStream ?? "").trim();
    if (!raw) return null;

    const variations = [raw, raw.toUpperCase(), raw.toLowerCase()];
    const uniqueVariations = [...new Set(variations)];

    // 1. Exact master_key match
    for (const v of uniqueVariations) {
        const rows = await q(
            `SELECT id FROM erp_master WHERE master_type = 'STREAM' AND master_key = ? LIMIT 1`,
            [v]
        );
        if (rows.length > 0) return rows[0].id;
    }

    // 2. Case-insensitive master_key
    for (const v of uniqueVariations) {
        const rows = await q(
            `SELECT id FROM erp_master WHERE master_type = 'STREAM' AND LOWER(master_key) = LOWER(?) LIMIT 1`,
            [v]
        );
        if (rows.length > 0) return rows[0].id;
    }

    // 3. Name match
    for (const v of uniqueVariations) {
        const rows = await q(
            `SELECT id FROM erp_master WHERE master_type = 'STREAM' AND LOWER(name) = LOWER(?) LIMIT 1`,
            [v]
        );
        if (rows.length > 0) return rows[0].id;
    }

    // 4. Partial match
    const rows = await q(
        `SELECT id FROM erp_master 
         WHERE master_type = 'STREAM' AND (name LIKE ? OR master_key LIKE ?)
         LIMIT 1`,
        [`%${raw}%`, `%${raw}%`]
    );
    return rows[0]?.id || null;
}

async function assertExamOpen(examId) {
    const rows = await q(
        `SELECT id, is_locked, status FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (rows.length === 0) throw new HttpError("Exam not found", 404);
    if (rows[0].is_locked) throw new HttpError("Exam is locked", 400);
    return rows[0];
}





// ============================================================
// SECTION 0.8: GRADING HELPERS
// ============================================================

let _gradeCache = { key: null, scheme_id: null, items: null, ts: 0 };

function cacheGrades(schemeId, items, now) {
    items.sort((a, b) => b.min - a.min);
    _gradeCache = { key: schemeId ?? "default", scheme_id: schemeId, items, ts: now };
    return items;
}

async function getGradingItems(schemeId = null) {
    const now = Date.now();
    if (_gradeCache.items && _gradeCache.key === (schemeId ?? "default") && (now - _gradeCache.ts) < 60000) {
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
            `SELECT id FROM erp_master WHERE master_type = 'GRADING_SCHEME' ORDER BY is_active DESC, id ASC LIMIT 1`
        );
        scheme = rows[0];
    }

    if (!scheme) return cacheGrades(schemeId, getDefaultGrading(), now);

    const items = await q(`
        SELECT master_key, name, data
        FROM erp_master
        WHERE master_type = 'GRADING_ITEM' AND parent_id = ? AND is_active = 1
        ORDER BY display_order ASC
    `, [scheme.id]);

    if (items.length === 0) return cacheGrades(schemeId, getDefaultGrading(), now);

    const parsed = items.map(i => {
        const d = safeJSONParse(i.data, {});
        return {
            min: parseFloat(d.min_percent ?? 0),
            max: parseFloat(d.max_percent ?? 100),
            grade: i.name || i.master_key,
            grade_point: parseFloat(d.grade_point ?? 0)
        };
    });

    return cacheGrades(schemeId, parsed, now);
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
        if (percentage >= g.min) return g.grade;
    }
    return items[items.length - 1]?.grade || "E";
}





// ============================================================
// SECTION 0.9: BACKUP SNAPSHOT HELPERS
// ============================================================

async function snapshotMarks({ student_id, session_id, exam_id, reason = "FINALIZED", user }) {
    const rows = await q(`
        SELECT m.*, sub.name AS subject_name
        FROM erp_marks m
        LEFT JOIN erp_master sub ON sub.id = m.subject_id
        WHERE m.record_type = 'MARKS'
          AND m.student_id = ? AND m.session_id = ? AND m.exam_id = ?
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

async function snapshotResult({ student_id, session_id, class_id, exam_id, result_type = "EXAM", reason = "FINALIZED", user }) {
    let stu;
    try { stu = await getStudentFromNstudent(student_id); } catch { return 0; }

    let examName = null;
    if (exam_id) {
        const exams = await q(
            `SELECT name FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
            [exam_id]
        );
        examName = exams[0]?.name || null;
    }

    const marksRows = await q(`
        SELECT m.*, sub.name AS subject_name
        FROM erp_marks m
        LEFT JOIN erp_master sub ON sub.id = m.subject_id
        WHERE m.record_type = 'MARKS'
          AND m.student_id = ? AND m.session_id = ?
          ${exam_id ? "AND m.exam_id = ?" : ""}
        ORDER BY sub.display_order ASC
    `, exam_id ? [student_id, session_id, exam_id] : [student_id, session_id]);

    if (marksRows.length === 0) return 0;

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

        if (exam_id) {
            const examSub = await q(`
                SELECT data FROM erp_exams
                WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
                LIMIT 1
            `, [exam_id, m.subject_id]);
            const cfg = examSub[0]?.data ? safeJSONParse(examSub[0].data, {}) : {};
            const passMarks = cfg.pass_marks || Math.ceil((cfg.max_marks || max || 100) * 0.33);
            const compFail = (val, cmax, cpass) =>
                (cmax || 0) > 0 && (cpass || 0) > 0 && (parseFloat(val) || 0) < cpass;

            if (m.absent_type === "Present" && (
                total < passMarks ||
                compFail(m.theory_marks, cfg.theory_max, cfg.theory_pass) ||
                compFail(m.practical_marks, cfg.practical_max, cfg.practical_pass) ||
                compFail(m.internal_marks, cfg.internal_max, cfg.internal_pass) ||
                compFail(m.project_marks, cfg.project_max, cfg.project_pass)
            )) {
                failedSubjects.push(m.subject_name);
            }
        }
    }

    const percentage = maxTotal > 0 ? parseFloat(((grandTotal / maxTotal) * 100).toFixed(2)) : 0;
    const overallGrade = await calculateGrade(percentage);

    let resultStatus = "Pass";
    if (hasWithheld) resultStatus = "Withheld";
    else if (hasAbsent) resultStatus = "Absent";
    else if (failedSubjects.length > 0) resultStatus = "Fail";
    else if (percentage < 33) resultStatus = "Fail";

    await q(`
        INSERT INTO erp_results_backup (
            student_id, session_id, class_id, exam_id, result_type,
            student_name, admission_number, apaar_id, roll_number,
            father_name, mother_name, dob, gender, category,
            class_name, section_name, stream, session_name,
            mobile_number, email_id, address, photo_url, signature_url,
            exam_name, grand_total, max_total, percentage, overall_grade,
            result_status, failed_subjects, subject_wise_marks,
            snapshot_reason, snapshot_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
// SECTION 1: ACADEMIC SESSIONS
// ============================================================

router.get("/sessions", asyncHandler(async (req, res) => {
    const rows = await q(`
        SELECT id, master_key AS session_code, name AS session_name,
               display_order, is_active, is_current, data, created_at, updated_at
        FROM erp_master
        WHERE master_type = 'SESSION'
        ORDER BY display_order DESC, id DESC
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

    if (!/^\d{4}-\d{2,4}$/.test(session_code)) {
        return fail(res, "Session code must be YYYY-YY format (e.g. 2026-27)", 400);
    }
    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
        return fail(res, "end_date cannot be before start_date", 400);
    }

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
        ...safeJSONParse(session.data, {}),
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
        old_value: session, new_value: req.body
    });

    return ok(res, { id }, "Session updated successfully");
}));

router.delete("/sessions/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const session = await getMasterById(id, "SESSION");

    const exams = await q(`SELECT COUNT(*) AS cnt FROM erp_exams WHERE session_id = ?`, [id]);
    if (exams[0].cnt > 0) {
        return fail(res, `Cannot delete: ${exams[0].cnt} exam(s) exist in this session`, 400);
    }

    const ss = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks WHERE record_type = 'STUDENT_SUBJECT' AND session_id = ?`,
        [id]
    );
    if (ss[0].cnt > 0) {
        return fail(res, `Cannot delete: ${ss[0].cnt} student subject assignment(s) exist`, 400);
    }

    await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    await auditLog({
        action: "SESSION_DELETED", entity_type: "SESSION",
        entity_id: id, user, old_value: session
    });

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
        return fail(res, `Invalid class_group. Allowed: ${VALID_CLASS_GROUPS.join(", ")}`, 400);
    }

    const key = String(class_name).trim();
    const existing = await getMasterByKey("CLASS", key);
    if (existing) return fail(res, `Class already exists: ${key}`, 409);

    const maxOrder = await q(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM erp_master WHERE master_type = 'CLASS'`
    );

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('CLASS', ?, ?, ?, 1, ?, ?)
    `, [
        key, `Class ${key}`,
        display_order || maxOrder[0].next_order,
        safeJSONStringify({ class_group }),
        user.user_id
    ]);

    await auditLog({
        action: "CLASS_CREATED", entity_type: "CLASS",
        entity_id: result.insertId, user, new_value: { class_name: key, class_group }
    });

    return ok(res, { id: result.insertId, class_name: key }, "Class created successfully", 201);
}));

router.put("/classes/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const cls = await getMasterById(id, "CLASS");

    const { class_name, class_group, display_order, is_active } = req.body;

    if (class_group && !VALID_CLASS_GROUPS.includes(class_group)) {
        return fail(res, `Invalid class_group. Allowed: ${VALID_CLASS_GROUPS.join(", ")}`, 400);
    }

    const newData = {
        ...safeJSONParse(cls.data, {}),
        ...(class_group ? { class_group } : {})
    };

    await q(`
        UPDATE erp_master
        SET name = COALESCE(?, name),
            display_order = COALESCE(?, display_order),
            is_active = COALESCE(?, is_active),
            data = ?, updated_by = ?
        WHERE id = ?
    `, [
        class_name ?? null,
        display_order ?? null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        safeJSONStringify(newData), user.user_id, id
    ]);

    await auditLog({
        action: "CLASS_UPDATED", entity_type: "CLASS",
        entity_id: id, user, old_value: cls, new_value: req.body
    });

    return ok(res, { id }, "Class updated successfully");
}));

router.delete("/classes/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const cls = await getMasterById(id, "CLASS");

    const exams = await q(`SELECT COUNT(*) AS cnt FROM erp_exams WHERE class_id = ? AND record_type = 'EXAM'`, [id]);
    if (exams[0].cnt > 0) return fail(res, `Cannot delete: ${exams[0].cnt} exam(s) exist`, 400);

    const sections = await q(`SELECT COUNT(*) AS cnt FROM erp_master WHERE master_type = 'SECTION' AND parent_id = ?`, [id]);
    if (sections[0].cnt > 0) return fail(res, `Cannot delete: ${sections[0].cnt} section(s) exist`, 400);

    const cs = await q(`SELECT COUNT(*) AS cnt FROM erp_master WHERE master_type = 'CLASS_SUBJECT' AND parent_id = ?`, [id]);
    if (cs[0].cnt > 0) return fail(res, `Cannot delete: ${cs[0].cnt} subject(s) mapped to this class`, 400);

    await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    await auditLog({
        action: "CLASS_DELETED", entity_type: "CLASS",
        entity_id: id, user, old_value: cls
    });

    return ok(res, null, "Class deleted successfully");
}));





// ============================================================
// SECTION 3: SECTIONS
// ============================================================

router.get("/sections", asyncHandler(async (req, res) => {
    const { class_id } = req.query;
    let sql = `
        SELECT s.id, s.master_key AS section_name, s.name, s.parent_id,
               s.display_order, s.is_active, s.data,
               c.master_key AS class_name, c.name AS class_display
        FROM erp_master s
        LEFT JOIN erp_master c ON c.id = s.parent_id AND c.master_type = 'CLASS'
        WHERE s.master_type = 'SECTION'
    `;
    const params = [];
    if (class_id) { sql += ` AND s.parent_id = ?`; params.push(parseId(class_id, "class_id")); }
    sql += ` ORDER BY c.display_order ASC, s.display_order ASC`;

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
    if (dup.length > 0) return fail(res, `Section ${section_name} already exists in this class`, 409);

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

router.put("/sections/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const section = await getMasterById(id, "SECTION");

    const { section_name, capacity, is_active } = req.body;

    if (section_name && section_name !== section.master_key) {
        const dup = await q(
            `SELECT id FROM erp_master WHERE master_type = 'SECTION' AND master_key = ? AND parent_id = ? AND id <> ? LIMIT 1`,
            [section_name, section.parent_id, id]
        );
        if (dup.length > 0) return fail(res, `Section ${section_name} already exists in this class`, 409);
    }

    const newData = {
        ...safeJSONParse(section.data, {}),
        ...(capacity !== undefined ? { capacity: toInt(capacity) } : {})
    };

    await q(`
        UPDATE erp_master
        SET master_key = COALESCE(?, master_key),
            name = COALESCE(?, name),
            is_active = COALESCE(?, is_active),
            data = ?, updated_by = ?
        WHERE id = ?
    `, [
        section_name ?? null,
        section_name ? `Section ${section_name}` : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        safeJSONStringify(newData), user.user_id, id
    ]);

    await auditLog({
        action: "SECTION_UPDATED", entity_type: "SECTION",
        entity_id: id, user, old_value: section, new_value: req.body
    });

    return ok(res, { id }, "Section updated successfully");
}));

router.delete("/sections/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    await getMasterById(id, "SECTION");

    const used = await q(`SELECT COUNT(*) AS cnt FROM erp_marks WHERE section_id = ?`, [id]);
    if (used[0].cnt > 0) return fail(res, `Cannot delete: ${used[0].cnt} record(s) use this section`, 400);

    await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    await auditLog({ action: "SECTION_DELETED", entity_type: "SECTION", entity_id: id, user });
    return ok(res, null, "Section deleted successfully");
}));





// ============================================================
// SECTION 4: STREAMS
// ============================================================

router.get("/streams", asyncHandler(async (req, res) => {
    const rows = await q(`
        SELECT id, master_key AS stream_code, name AS stream_name,
               display_order, is_active, data, created_at
        FROM erp_master WHERE master_type = 'STREAM' AND is_active = 1
        ORDER BY display_order ASC
    `);
    return ok(res, rows, "Streams fetched successfully");
}));

router.post("/streams", asyncHandler(async (req, res) => {
    requireFields(req.body, ["stream_name", "stream_code"]);
    const user = getUserContext(req);
    const { stream_name, stream_code, display_order } = req.body;

    const code = String(stream_code).toUpperCase().trim();
    const existing = await getMasterByKey("STREAM", code);
    if (existing) return fail(res, `Stream already exists: ${code}`, 409);

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('STREAM', ?, ?, ?, 1, ?, ?)
    `, [
        code, stream_name,
        toInt(display_order) || 1,
        safeJSONStringify({ stream_name }),
        user.user_id
    ]);

    await auditLog({
        action: "STREAM_CREATED", entity_type: "STREAM",
        entity_id: result.insertId, user,
        new_value: { stream_name, stream_code: code }
    });

    return ok(res, { id: result.insertId, stream_code: code }, "Stream created successfully", 201);
}));

router.put("/streams/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const stream = await getMasterById(id, "STREAM");

    const { stream_name, display_order, is_active } = req.body;

    await q(`
        UPDATE erp_master
        SET name = COALESCE(?, name),
            display_order = COALESCE(?, display_order),
            is_active = COALESCE(?, is_active),
            updated_by = ?
        WHERE id = ?
    `, [
        stream_name ?? null,
        display_order ?? null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        user.user_id, id
    ]);

    await auditLog({
        action: "STREAM_UPDATED", entity_type: "STREAM",
        entity_id: id, user, old_value: stream, new_value: req.body
    });

    return ok(res, { id }, "Stream updated successfully");
}));

router.delete("/streams/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    await getMasterById(id, "STREAM");

    const usage = await q(`SELECT COUNT(*) AS cnt FROM erp_marks WHERE stream_id = ?`, [id]);
    if (usage[0].cnt > 0) {
        return fail(res, `Cannot delete: ${usage[0].cnt} student record(s) use this stream`, 400);
    }
    const mapped = await q(
        `SELECT COUNT(*) AS cnt FROM erp_master WHERE master_type = 'CLASS_SUBJECT' AND ${JX("data", "$.stream_id")} <=> ?`,
        [id]
    );
    if (mapped[0].cnt > 0) {
        return fail(res, `Cannot delete: ${mapped[0].cnt} class-subject mapping(s) use this stream`, 400);
    }

    await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    await auditLog({ action: "STREAM_DELETED", entity_type: "STREAM", entity_id: id, user });

    return ok(res, null, "Stream deleted successfully");
}));





// ============================================================
// SECTION 5: SUBJECTS
// ============================================================

router.get("/subjects", asyncHandler(async (req, res) => {
    const { type, search, is_active } = req.query;

    let sql = `
        SELECT
            s.id, s.master_key AS subject_code, s.name AS subject_name,
            s.display_order, s.is_active, s.data, s.created_at,
            (SELECT COUNT(DISTINCT cs.parent_id)
             FROM erp_master cs
             WHERE cs.master_type = 'CLASS_SUBJECT'
               AND ${JX("cs.data", "$.subject_id")} <=> s.id
            ) AS classes_count,
            (SELECT COUNT(*)
             FROM erp_marks ss
             WHERE ss.record_type = 'STUDENT_SUBJECT'
               AND ss.subject_id = s.id
            ) AS students_count
        FROM erp_master s
        WHERE s.master_type = 'SUBJECT'
    `;
    const params = [];

    if (type) { sql += ` AND ${JX("s.data", "$.subject_type")} = ?`; params.push(type); }
    if (search) {
        sql += ` AND (s.name LIKE ? OR s.master_key LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
    }
    if (is_active !== undefined && is_active !== "") {
        sql += ` AND s.is_active = ?`;
        params.push(is_active === "true" || is_active === "1" ? 1 : 0);
    }
    sql += ` ORDER BY s.display_order ASC, s.name ASC`;

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
        subject_type = "Core", component_type = "Theory",
        display_order,
        theory_max = 0, theory_pass,
        practical_max = 0, practical_pass,
        internal_max = 0, internal_pass,
        project_max = 0, project_pass,
        total_max, total_pass,
        theory_weight = 0, practical_weight = 0, internal_weight = 0
    } = req.body;

    const code = String(subject_code).toUpperCase().trim().replace(/\s+/g, "_");
    const existing = await getMasterByKey("SUBJECT", code);
    if (existing) return fail(res, `Subject already exists: ${code}`, 409);

    if (!VALID_SUBJECT_TYPES.includes(subject_type)) {
        return fail(res, `Invalid subject_type. Allowed: ${VALID_SUBJECT_TYPES.join(", ")}`, 400);
    }
    if (!VALID_COMPONENT_TYPES.includes(component_type)) {
        return fail(res, `Invalid component_type. Allowed: ${VALID_COMPONENT_TYPES.join(", ")}`, 400);
    }

    const maxOrder = await q(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM erp_master WHERE master_type = 'SUBJECT'`
    );

    const calculatedTotal = (parseInt(theory_max) || 0) + (parseInt(practical_max) || 0) +
                            (parseInt(internal_max) || 0) + (parseInt(project_max) || 0);
    if (calculatedTotal > 0 && parseInt(total_max) && parseInt(total_max) !== calculatedTotal) {
        return fail(res, `total_max (${total_max}) must equal sum of component maxes (${calculatedTotal})`, 400);
    }
    const finalTotalMax = parseInt(total_max) || calculatedTotal || 100;
    const finalTotalPass = parseInt(total_pass) || Math.ceil(finalTotalMax * 0.33);

    const subjectData = {
        subject_short_name: subject_short_name || subject_name,
        subject_type,
        component_type,
        theory_max: parseInt(theory_max) || 0,
        theory_pass: defPass(theory_max, theory_pass),
        practical_max: parseInt(practical_max) || 0,
        practical_pass: defPass(practical_max, practical_pass),
        internal_max: parseInt(internal_max) || 0,
        internal_pass: defPass(internal_max, internal_pass),
        project_max: parseInt(project_max) || 0,
        project_pass: defPass(project_max, project_pass),
        total_max: finalTotalMax,
        total_pass: finalTotalPass,
        theory_weight: parseFloat(theory_weight) || 0,
        practical_weight: parseFloat(practical_weight) || 0,
        internal_weight: parseFloat(internal_weight) || 0
    };

    const result = await q(`
        INSERT INTO erp_master (master_type, master_key, name, display_order, is_active, data, created_by)
        VALUES ('SUBJECT', ?, ?, ?, 1, ?, ?)
    `, [
        code, subject_name,
        toInt(display_order) || maxOrder[0].next_order,
        safeJSONStringify(subjectData),
        user.user_id
    ]);

    await auditLog({
        action: "SUBJECT_CREATED", entity_type: "SUBJECT",
        entity_id: result.insertId, user,
        new_value: { subject_code: code, subject_name, ...subjectData }
    });

    return ok(res, { id: result.insertId, subject_code: code }, "Subject created successfully", 201);
}));

router.put("/subjects/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const subject = await getMasterById(id, "SUBJECT");

    const {
        subject_name, subject_short_name, subject_type, component_type,
        display_order, is_active,
        theory_max, theory_pass,
        practical_max, practical_pass,
        internal_max, internal_pass,
        project_max, project_pass,
        total_max, total_pass,
        theory_weight, practical_weight, internal_weight
    } = req.body;

    if (subject_type && !VALID_SUBJECT_TYPES.includes(subject_type)) {
        return fail(res, `Invalid subject_type`, 400);
    }
    if (component_type && !VALID_COMPONENT_TYPES.includes(component_type)) {
        return fail(res, `Invalid component_type`, 400);
    }

    const oldData = safeJSONParse(subject.data, {});

    const newData = {
        ...oldData,
        ...(subject_short_name !== undefined ? { subject_short_name } : {}),
        ...(subject_type !== undefined ? { subject_type } : {}),
        ...(component_type !== undefined ? { component_type } : {}),
        ...(theory_max !== undefined ? { theory_max: parseInt(theory_max) || 0 } : {}),
        ...(theory_pass !== undefined ? { theory_pass: parseInt(theory_pass) || 0 } : {}),
        ...(practical_max !== undefined ? { practical_max: parseInt(practical_max) || 0 } : {}),
        ...(practical_pass !== undefined ? { practical_pass: parseInt(practical_pass) || 0 } : {}),
        ...(internal_max !== undefined ? { internal_max: parseInt(internal_max) || 0 } : {}),
        ...(internal_pass !== undefined ? { internal_pass: parseInt(internal_pass) || 0 } : {}),
        ...(project_max !== undefined ? { project_max: parseInt(project_max) || 0 } : {}),
        ...(project_pass !== undefined ? { project_pass: parseInt(project_pass) || 0 } : {}),
        ...(theory_weight !== undefined ? { theory_weight: parseFloat(theory_weight) || 0 } : {}),
        ...(practical_weight !== undefined ? { practical_weight: parseFloat(practical_weight) || 0 } : {}),
        ...(internal_weight !== undefined ? { internal_weight: parseFloat(internal_weight) || 0 } : {})
    };

    if (theory_max !== undefined || practical_max !== undefined ||
        internal_max !== undefined || project_max !== undefined) {
        const calcTotal = (newData.theory_max || 0) + (newData.practical_max || 0) +
                          (newData.internal_max || 0) + (newData.project_max || 0);
        newData.total_max = parseInt(total_max) || calcTotal || 100;
        newData.total_pass = parseInt(total_pass) || Math.ceil(newData.total_max * 0.33);
    } else {
        if (total_max !== undefined) newData.total_max = parseInt(total_max) || 100;
        if (total_pass !== undefined) newData.total_pass = parseInt(total_pass) || 0;
    }

    await q(`
        UPDATE erp_master
        SET name = COALESCE(?, name),
            display_order = COALESCE(?, display_order),
            is_active = COALESCE(?, is_active),
            data = ?, updated_by = ?
        WHERE id = ?
    `, [
        subject_name ?? null,
        display_order ?? null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        safeJSONStringify(newData), user.user_id, id
    ]);

    await auditLog({
        action: "SUBJECT_UPDATED", entity_type: "SUBJECT",
        entity_id: id, user, old_value: subject, new_value: req.body
    });

    return ok(res, { id }, "Subject updated successfully");
}));

// ============================================================
// 🆕 UPDATED: DELETE SUBJECT with force option
// ============================================================
// Usage:
//   DELETE /subjects/:id          → fails if subject is in use
//   DELETE /subjects/:id?force=true → cascade delete everything
//
// Force delete removes:
//   - erp_marks_backup (marks snapshots)
//   - erp_marks (MARKS records)
//   - erp_marks (STUDENT_SUBJECT assignments)
//   - erp_exams (EXAM_SUBJECT entries)
//   - erp_master (CLASS_SUBJECT mappings)
//   - erp_master (SUBJECT itself)
// ============================================================
router.delete("/subjects/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const force = req.query.force === "true";

    const subject = await getMasterById(id, "SUBJECT");

    // ─── Count usages across all tables ───
    const classMaps = await q(
        `SELECT COUNT(*) AS cnt FROM erp_master
         WHERE master_type = 'CLASS_SUBJECT'
           AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.subject_id')), 'null') <=> ?`,
        [id]
    );
    const examSubs = await q(
        `SELECT COUNT(*) AS cnt FROM erp_exams
         WHERE record_type = 'EXAM_SUBJECT' AND subject_id = ?`,
        [id]
    );
    const studentSubs = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks
         WHERE record_type = 'STUDENT_SUBJECT' AND subject_id = ?`,
        [id]
    );
    const marks = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks
         WHERE record_type = 'MARKS' AND subject_id = ?`,
        [id]
    );

    const totalUsage =
        (classMaps[0].cnt || 0) +
        (examSubs[0].cnt || 0) +
        (studentSubs[0].cnt || 0) +
        (marks[0].cnt || 0);

    // ─── Non-force: block if used ───
    if (totalUsage > 0 && !force) {
        const reasons = [];
        if (classMaps[0].cnt > 0) reasons.push(`${classMaps[0].cnt} class mapping(s)`);
        if (examSubs[0].cnt > 0) reasons.push(`${examSubs[0].cnt} exam(s)`);
        if (studentSubs[0].cnt > 0) reasons.push(`${studentSubs[0].cnt} student assignment(s)`);
        if (marks[0].cnt > 0) reasons.push(`${marks[0].cnt} marks record(s)`);

        return fail(res,
            `Cannot delete: subject is used in ${reasons.join(", ")}. Add ?force=true to delete everything.`,
            400);
    }

    // ─── FORCE DELETE: cascade in safe order ───
    let deletedBackupMarks = 0;
    let deletedMarks = 0;
    let deletedStudentSubjects = 0;
    let deletedExamSubjects = 0;
    let deletedClassMaps = 0;

    if (force) {
        // 1. Marks backup
        try {
            const r1 = await q(`DELETE FROM erp_marks_backup WHERE subject_id = ?`, [id]);
            deletedBackupMarks = r1.affectedRows || 0;
        } catch (e) {
            log.warn("erp_marks_backup delete skipped", { error: e.message });
        }

        // 2. Actual marks
        const r2 = await q(
            `DELETE FROM erp_marks WHERE record_type = 'MARKS' AND subject_id = ?`,
            [id]
        );
        deletedMarks = r2.affectedRows || 0;

        // 3. Student subject assignments
        const r3 = await q(
            `DELETE FROM erp_marks WHERE record_type = 'STUDENT_SUBJECT' AND subject_id = ?`,
            [id]
        );
        deletedStudentSubjects = r3.affectedRows || 0;

        // 4. Exam subject entries
        const r4 = await q(
            `DELETE FROM erp_exams WHERE record_type = 'EXAM_SUBJECT' AND subject_id = ?`,
            [id]
        );
        deletedExamSubjects = r4.affectedRows || 0;

        // 5. Class subject mappings
        const r5 = await q(
            `DELETE FROM erp_master
             WHERE master_type = 'CLASS_SUBJECT'
               AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.subject_id')), 'null') <=> ?`,
            [id]
        );
        deletedClassMaps = r5.affectedRows || 0;

        // 6. The subject itself
        await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    } else {
        // No usage — safe delete
        await q(`DELETE FROM erp_master WHERE id = ?`, [id]);
    }

    await auditLog({
        action: force ? "SUBJECT_FORCE_DELETED" : "SUBJECT_DELETED",
        entity_type: "SUBJECT",
        entity_id: id,
        user,
        old_value: subject,
        new_value: {
            force,
            deleted_backup_marks: deletedBackupMarks,
            deleted_marks: deletedMarks,
            deleted_student_subjects: deletedStudentSubjects,
            deleted_exam_subjects: deletedExamSubjects,
            deleted_class_maps: deletedClassMaps
        }
    });

    log.success("Subject deleted", { subjectId: id, force });

    return ok(res, {
        deleted_backup_marks: deletedBackupMarks,
        deleted_marks: deletedMarks,
        deleted_student_subjects: deletedStudentSubjects,
        deleted_exam_subjects: deletedExamSubjects,
        deleted_class_maps: deletedClassMaps,
        force
    }, force
        ? "Subject force-deleted with all related data"
        : "Subject deleted successfully");
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
               sub.id AS subject_id, sub.master_key AS subject_code,
               sub.name AS subject_name, sub.data AS subject_data
        FROM erp_master cs
        JOIN erp_master sub ON sub.id = CAST(${JX("cs.data", "$.subject_id")} AS UNSIGNED)
        WHERE cs.master_type = 'CLASS_SUBJECT' AND cs.parent_id = ?
    `;
    const params = [parseId(class_id, "class_id")];

    if (stream_id) {
        sql += ` AND (${JX("cs.data", "$.stream_id")} IS NULL OR ${JX("cs.data", "$.stream_id")} <=> ?)`;
        params.push(parseId(stream_id, "stream_id"));
    }
    sql += ` ORDER BY cs.display_order ASC`;

    const rows = await q(sql, params);
    const result = rows.map(r => {
        const data = safeJSONParse(r.data, {});
        return {
            id: r.id,
            class_id: r.class_id,
            subject_id: r.subject_id,
            subject_code: r.subject_code,
            subject_name: r.subject_name,
            subject_data: safeJSONParse(r.subject_data, {}),
            is_optional: data.is_optional || false,
            is_core: data.is_core !== false,
            stream_id: data.stream_id || null,
            is_active: !!r.is_active
        };
    });
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
    const isOptional = !!req.body.is_optional;

    let added = 0, skipped = 0;
    for (const sid of subjectIds) {
        const subjectId = parseId(sid, "subject_id");
        await getMasterById(subjectId, "SUBJECT");

        const dup = await q(`
            SELECT id FROM erp_master
            WHERE master_type = 'CLASS_SUBJECT' AND parent_id = ?
              AND ${JX("data", "$.subject_id")} <=> ?
              AND ${JX("data", "$.stream_id")} <=> ?
            LIMIT 1
        `, [classId, subjectId, streamId]);

        if (dup.length > 0) { skipped++; continue; }

        const maxOrder = await q(
            `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
             FROM erp_master WHERE master_type = 'CLASS_SUBJECT' AND parent_id = ?`,
            [classId]
        );

        await q(`
            INSERT INTO erp_master (master_type, master_key, name, parent_id, display_order, is_active, data, created_by)
            VALUES ('CLASS_SUBJECT', ?, ?, ?, ?, 1, ?, ?)
        `, [
            `CS_${classId}_${subjectId}_${streamId || 'all'}`,
            `Class-Subject ${classId}-${subjectId}`,
            classId, maxOrder[0].next_order,
            safeJSONStringify({
                subject_id: subjectId,
                stream_id: streamId,
                is_optional: isOptional,
                is_core: !isOptional
            }),
            user.user_id
        ]);
        added++;
    }

    await auditLog({
        action: "CLASS_SUBJECTS_ADDED", entity_type: "CLASS_SUBJECT", user,
        new_value: { class_id: classId, subject_ids: subjectIds, stream_id: streamId, added, skipped }
    });

    return ok(res, { added, skipped, requested: subjectIds.length }, `${added} subject(s) added to class`);
}));

router.delete("/class-subjects/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
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
// SECTION 7: STUDENT-SUBJECT ASSIGNMENT (MANUAL ONLY)
// ============================================================
// NOTE: Auto-assign has been REMOVED. All assignments are manual.
// Routes:
//   GET  /student-subjects/:studentId       → list assigned subjects
//   POST /student-subjects/assign           → manual single assign
//   POST /student-subjects/bulk-assign      → manual bulk assign (multiple students)
//   DELETE /student-subjects/:id            → remove an assignment
//   GET  /student-subjects/debug/:studentId → diagnostic info
// ============================================================

router.get("/student-subjects/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.query;

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
    if (session_id) { sql += ` AND ss.session_id = ?`; params.push(parseId(session_id)); }
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

// Manual assign: { student_id, session_id, subject_ids: [] }
router.post("/student-subjects/assign", asyncHandler(async (req, res) => {
    requireFields(req.body, ["student_id", "session_id", "subject_ids"]);
    const user = getUserContext(req);

    const studentId = String(req.body.student_id).trim();
    const sessionId = parseId(req.body.session_id, "session_id");

    const student = await getStudentFromNstudent(studentId);

    const classRow = await resolveClassRow(student.class);
    if (!classRow) return fail(res, `Class "${student.class}" not configured`, 400);
    const classId = classRow.id;
    const sectionId = await resolveSectionId(classId, student.section);
    const streamId = await resolveStreamId(student.stream);

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
            studentId, sessionId, classId,
            sectionId, streamId, subjectId,
            safeJSONStringify({ is_optional: !!req.body.is_optional, assigned_by: user.user_id })
        ]);
        added++;
    }

    await auditLog({
        action: "STUDENT_SUBJECTS_ASSIGNED", entity_type: "STUDENT_SUBJECT",
        student_id: studentId, session_id: sessionId, user,
        new_value: { class_id: classId, subject_ids: subjectIds, added, skipped }
    });

    return ok(res, {
        added, skipped, requested: subjectIds.length,
        student: { class: student.class, section: student.section, stream: student.stream }
    }, `${added} subject(s) assigned`);
}));

// ============================================================
// 🆕 NEW: BULK ASSIGN subjects to multiple students
// ============================================================
// Body: { session_id, student_ids: [], subject_ids: [] }
// ============================================================
router.post("/student-subjects/bulk-assign", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    requireFields(req.body, ["session_id", "student_ids", "subject_ids"]);
    const user = getUserContext(req);

    const sessionId = parseId(req.body.session_id, "session_id");
    const studentIds = Array.isArray(req.body.student_ids)
        ? req.body.student_ids
        : [req.body.student_ids];
    const subjectIds = Array.isArray(req.body.subject_ids)
        ? req.body.subject_ids
        : [req.body.subject_ids];

    if (studentIds.length === 0) return fail(res, "student_ids is required", 400);
    if (subjectIds.length === 0) return fail(res, "subject_ids is required", 400);

    let added = 0, skipped = 0;
    const errors = [];
    const results = [];

    for (const sid of studentIds) {
        const studentId = String(sid).trim();
        let student;
        try {
            student = await getStudentFromNstudent(studentId);
        } catch (e) {
            errors.push({ student_id: studentId, error: "Student not found" });
            continue;
        }

        const classRow = await resolveClassRow(student.class);
        if (!classRow) {
            errors.push({ student_id: studentId, error: `Class "${student.class}" not configured` });
            continue;
        }
        const sectionId = await resolveSectionId(classRow.id, student.section);
        const streamId = await resolveStreamId(student.stream);

        let studentAdded = 0, studentSkipped = 0;

        for (const subjId of subjectIds) {
            const subjectId = parseId(subjId, "subject_id");

            const dup = await q(`
                SELECT id FROM erp_marks
                WHERE record_type = 'STUDENT_SUBJECT'
                  AND student_id = ? AND session_id = ? AND subject_id = ?
                LIMIT 1
            `, [studentId, sessionId, subjectId]);

            if (dup.length > 0) { studentSkipped++; skipped++; continue; }

            try {
                await q(`
                    INSERT INTO erp_marks (
                        record_type, student_id, session_id, class_id,
                        section_id, stream_id, subject_id, status, data, created_at
                    ) VALUES ('STUDENT_SUBJECT', ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NOW())
                `, [
                    studentId, sessionId, classRow.id,
                    sectionId, streamId, subjectId,
                    safeJSONStringify({ is_optional: false, assigned_by: user.user_id })
                ]);
                studentAdded++;
                added++;
            } catch (e) {
                errors.push({
                    student_id: studentId,
                    subject_id: subjectId,
                    error: e.message
                });
            }
        }

        results.push({
            student_id: studentId,
            name: student.name,
            added: studentAdded,
            skipped: studentSkipped
        });
    }

    await auditLog({
        action: "STUDENT_SUBJECTS_BULK_ASSIGNED",
        entity_type: "STUDENT_SUBJECT",
        session_id: sessionId,
        user,
        new_value: {
            student_count: studentIds.length,
            subject_count: subjectIds.length,
            added, skipped, errors: errors.length
        }
    });

    return ok(res, {
        students_processed: studentIds.length,
        subjects_per_student: subjectIds.length,
        total_added: added,
        total_skipped: skipped,
        errors,
        results
    }, `${added} assignments created, ${skipped} skipped`);
}));

router.delete("/student-subjects/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);

    const rows = await q(
        `SELECT * FROM erp_marks WHERE id = ? AND record_type = 'STUDENT_SUBJECT' LIMIT 1`,
        [id]
    );
    if (rows.length === 0) return fail(res, "Student subject not found", 404);

    const marks = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks
         WHERE record_type = 'MARKS' AND student_id = ? AND session_id = ? AND subject_id = ?`,
        [rows[0].student_id, rows[0].session_id, rows[0].subject_id]
    );
    if (marks[0].cnt > 0) {
        return fail(res, "Cannot remove: marks already entered for this subject", 400);
    }

    await q(`DELETE FROM erp_marks WHERE id = ?`, [id]);

    await auditLog({
        action: "STUDENT_SUBJECT_REMOVED", entity_type: "STUDENT_SUBJECT",
        entity_id: id, student_id: rows[0].student_id, user, old_value: rows[0]
    });

    return ok(res, null, "Student subject removed");
}));

// ============================================================
// 🆕 NEW: DEBUG endpoint for subject allocation diagnostics
// ============================================================
// Usage: GET /student-subjects/debug/:studentId?session_id=5
// Returns: resolved class/section/stream, available subjects, assigned subjects, issues
// ============================================================
router.get("/student-subjects/debug/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.query;

    const student = await getStudentFromNstudent(studentId);

    const diagnostics = {
        student: {
            student_id: student.student_id,
            name: student.name,
            raw_class: student.class,
            raw_section: student.section,
            raw_stream: student.stream,
            raw_session: student.session
        },
        resolved: {},
        available_class_subjects: [],
        assigned_subjects: [],
        issues: []
    };

    // 1. Resolve class
    const classRow = await resolveClassRow(student.class);
    if (!classRow) {
        diagnostics.issues.push(`Class "${student.class}" not found in erp_master (master_type='CLASS')`);
        return ok(res, diagnostics, "Diagnostics completed");
    }
    diagnostics.resolved.class = {
        id: classRow.id,
        master_key: classRow.master_key,
        name: classRow.name
    };

    // 2. Resolve section
    const sectionId = await resolveSectionId(classRow.id, student.section);
    if (!sectionId && student.section) {
        diagnostics.issues.push(`Section "${student.section}" not found for class ${classRow.master_key}`);
    }
    diagnostics.resolved.section = sectionId;

    // 3. Resolve stream
    const streamId = await resolveStreamId(student.stream);
    if (!streamId && student.stream) {
        diagnostics.issues.push(`Stream "${student.stream}" not found in erp_master (master_type='STREAM')`);
    }
    diagnostics.resolved.stream = streamId;

    // 4. List all class-subjects mapped
    const mapped = await q(`
        SELECT cs.id, cs.data, cs.is_active,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cs.data, '$.subject_id')), 'null') AS subj_id,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cs.data, '$.stream_id')), 'null') AS stream_id,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cs.data, '$.is_optional')), 'null') AS is_opt,
               sub.master_key AS subject_code, sub.name AS subject_name
        FROM erp_master cs
        LEFT JOIN erp_master sub
            ON sub.id = CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cs.data, '$.subject_id')), 'null') AS UNSIGNED)
        WHERE cs.master_type = 'CLASS_SUBJECT' AND cs.parent_id = ?
    `, [classRow.id]);

    if (mapped.length === 0) {
        diagnostics.issues.push(`No subjects mapped to class ${classRow.master_key}. Use /class-subjects to add subjects.`);
    }

    diagnostics.available_class_subjects = mapped.map(m => ({
        mapping_id: m.id,
        subject_id: m.subj_id,
        subject_code: m.subject_code,
        subject_name: m.subject_name,
        stream_id: m.stream_id,
        is_optional: m.is_opt === "true" || m.is_opt === "1",
        is_active: !!m.is_active
    }));

    // 5. List assigned subjects
    if (session_id) {
        const assigned = await q(`
            SELECT ss.id, ss.subject_id, ss.status, ss.created_at,
                   sub.master_key AS subject_code, sub.name AS subject_name
            FROM erp_marks ss
            LEFT JOIN erp_master sub ON sub.id = ss.subject_id
            WHERE ss.record_type = 'STUDENT_SUBJECT'
              AND ss.student_id = ?
              AND ss.session_id = ?
        `, [studentId, parseId(session_id)]);
        diagnostics.assigned_subjects = assigned;
    } else {
        const assigned = await q(`
            SELECT ss.id, ss.session_id, ss.subject_id, ss.status,
                   sub.master_key AS subject_code, sub.name AS subject_name
            FROM erp_marks ss
            LEFT JOIN erp_master sub ON sub.id = ss.subject_id
            WHERE ss.record_type = 'STUDENT_SUBJECT' AND ss.student_id = ?
        `, [studentId]);
        diagnostics.assigned_subjects = assigned;
    }

    if (diagnostics.assigned_subjects.length === 0) {
        diagnostics.issues.push(`No subjects assigned to student ${studentId} yet.`);
    }

    return ok(res, diagnostics, "Diagnostics completed successfully");
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

    if (!VALID_CLASS_GROUPS.includes(class_group)) {
        return fail(res, `Invalid class_group. Allowed: ${VALID_CLASS_GROUPS.join(", ")}`, 400);
    }

    const masterKey = String(template_name).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100);
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
            String(item.exam_code).toUpperCase(), item.exam_name, templateId,
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
// SECTION 9: EXAMS
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

router.post("/exams", asyncHandler(async (req, res) => {
    requireFields(req.body, ["session_id", "class_id", "exam_code", "exam_name"]);
    const user = getUserContext(req);

    const sessionId = parseId(req.body.session_id);
    const classId = parseId(req.body.class_id);
    const examCode = String(req.body.exam_code).toUpperCase().trim();
    const examName = String(req.body.exam_name).trim();
    const examType = req.body.exam_type || "Summative";
    const examSession = trimStr(req.body.exam_session, 50);
    const startDate = req.body.start_date || null;
    const endDate = req.body.end_date || null;
    const resultDate = req.body.result_date || null;
    const weightage = toDecimal(req.body.weightage_percent);

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        return fail(res, "end_date cannot be before start_date", 400);
    }
    if (weightage !== null && (weightage < 0 || weightage > 100)) {
        return fail(res, "weightage_percent must be between 0 and 100", 400);
    }

    await getMasterById(sessionId, "SESSION");
    await getMasterById(classId, "CLASS");

    const dup = await q(`
        SELECT id FROM erp_exams
        WHERE record_type = 'EXAM' AND session_id = ? AND class_id = ? AND exam_code = ?
        LIMIT 1
    `, [sessionId, classId, examCode]);
    if (dup.length > 0) return fail(res, `Exam "${examCode}" already exists for this class & session`, 409);

    const maxOrder = await q(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
         FROM erp_exams WHERE record_type = 'EXAM' AND session_id = ? AND class_id = ?`,
        [sessionId, classId]
    );

    const result = await q(`
        INSERT INTO erp_exams (
            record_type, session_id, class_id, exam_code, name, exam_type,
            display_order, status, start_date, end_date, result_date, data, created_by
        ) VALUES ('EXAM', ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)
    `, [
        sessionId, classId, examCode, examName, examType,
        maxOrder[0].next_order,
        startDate, endDate, resultDate,
        safeJSONStringify({ exam_session: examSession, weightage_percent: weightage }),
        user.user_id
    ]);

    await auditLog({
        action: "EXAM_CREATED", entity_type: "EXAM",
        entity_id: result.insertId, session_id: sessionId, user,
        new_value: { exam_code: examCode, exam_name: examName, class_id: classId }
    });

    return ok(res, { id: result.insertId, exam_code: examCode }, "Exam created successfully", 201);
}));

router.put("/exams/:id", asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [id]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam is locked", 400);

    const { exam_name, exam_type, start_date, end_date, result_date, exam_session } = req.body;

    const newData = {
        ...safeJSONParse(exam.data, {}),
        ...(exam_session !== undefined ? { exam_session } : {}),
        ...(req.body.weightage_percent !== undefined
            ? { weightage_percent: toDecimal(req.body.weightage_percent) } : {})
    };

    await q(`
        UPDATE erp_exams
        SET name = COALESCE(?, name),
            exam_type = COALESCE(?, exam_type),
            start_date = COALESCE(?, start_date),
            end_date = COALESCE(?, end_date),
            result_date = COALESCE(?, result_date),
            data = ?, updated_by = ?
        WHERE id = ?
    `, [
        exam_name ?? null,
        exam_type ?? null,
        start_date ?? null,
        end_date ?? null,
        result_date ?? null,
        safeJSONStringify(newData), user.user_id, id
    ]);

    await auditLog({
        action: "EXAM_UPDATED", entity_type: "EXAM",
        entity_id: id, user, old_value: exam, new_value: req.body
    });

    return ok(res, { id }, "Exam updated successfully");
}));

// ============================================================
// 🆕 UPDATED: DELETE EXAM with force option
// ============================================================
// Usage:
//   DELETE /exams/:id          → fails if marks exist or locked
//   DELETE /exams/:id?force=true → cascade delete everything
// ============================================================
router.delete("/exams/:id", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const user = getUserContext(req);
    const force = req.query.force === "true";

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [id]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    // Locked exam — only force delete allowed
    if (exam.is_locked && !force) {
        return fail(res, "Cannot delete locked exam. Use ?force=true to override.", 400);
    }

    // Count marks
    const marks = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks WHERE record_type = 'MARKS' AND exam_id = ?`,
        [id]
    );
    const marksCount = marks[0]?.cnt || 0;

    if (marksCount > 0 && !force) {
        return fail(res,
            `Cannot delete: ${marksCount} marks record(s) exist. Add ?force=true to delete everything.`,
            400);
    }

    // ─── FORCE DELETE ───
    let deletedMarks = 0;
    let deletedBackupMarks = 0;
    let deletedBackupResults = 0;
    let deletedExamSubjects = 0;

    if (force) {
        // 1. Delete marks backup
        try {
            const r1 = await q(`DELETE FROM erp_marks_backup WHERE exam_id = ?`, [id]);
            deletedBackupMarks = r1.affectedRows || 0;
        } catch (e) {
            log.warn("erp_marks_backup delete skipped", { error: e.message });
        }

        // 2. Delete results backup
        try {
            const r2 = await q(
                `DELETE FROM erp_results_backup WHERE exam_id = ? AND result_type = 'EXAM'`,
                [id]
            );
            deletedBackupResults = r2.affectedRows || 0;
        } catch (e) {
            log.warn("erp_results_backup delete skipped", { error: e.message });
        }

        // 3. Delete marks
        const r3 = await q(
            `DELETE FROM erp_marks WHERE record_type = 'MARKS' AND exam_id = ?`,
            [id]
        );
        deletedMarks = r3.affectedRows || 0;
    }

    // 4. Delete exam subjects (always)
    const r4 = await q(
        `DELETE FROM erp_exams WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ?`,
        [id]
    );
    deletedExamSubjects = r4.affectedRows || 0;

    // 5. Delete the exam itself
    await q(`DELETE FROM erp_exams WHERE id = ?`, [id]);

    await auditLog({
        action: force ? "EXAM_FORCE_DELETED" : "EXAM_DELETED",
        entity_type: "EXAM",
        entity_id: id,
        user,
        old_value: exam,
        new_value: {
            deleted_marks: deletedMarks,
            deleted_backup_marks: deletedBackupMarks,
            deleted_backup_results: deletedBackupResults,
            deleted_exam_subjects: deletedExamSubjects,
            force
        }
    });

    log.success("Exam deleted", { examId: id, force });

    return ok(res, {
        deleted_marks: deletedMarks,
        deleted_backup_marks: deletedBackupMarks,
        deleted_backup_results: deletedBackupResults,
        deleted_exam_subjects: deletedExamSubjects,
        force
    }, force
        ? `Exam force-deleted with all related data`
        : `Exam deleted successfully`);
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
        const subjRow = await getMasterById(subjectId, "SUBJECT");
        const subjData = safeJSONParse(subjRow.data, {});

        const dup = await q(`
            SELECT id FROM erp_exams
            WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
            LIMIT 1
        `, [examId, subjectId]);
        if (dup.length > 0) { skipped++; continue; }

        const maxMarks = toInt(req.body.max_marks) || subjData.total_max || 100;
        const passMarks = toInt(req.body.pass_marks) || subjData.total_pass || Math.ceil(maxMarks * 0.33);

        const examSubjectData = {
            max_marks: maxMarks,
            pass_marks: passMarks,
            theory_max: toInt(req.body.theory_max) || subjData.theory_max || 0,
            theory_pass: toInt(req.body.theory_pass) || subjData.theory_pass || 0,
            practical_max: toInt(req.body.practical_max) || subjData.practical_max || 0,
            practical_pass: toInt(req.body.practical_pass) || subjData.practical_pass || 0,
            internal_max: toInt(req.body.internal_max) || subjData.internal_max || 0,
            internal_pass: toInt(req.body.internal_pass) || subjData.internal_pass || 0,
            project_max: toInt(req.body.project_max) || subjData.project_max || 0,
            project_pass: toInt(req.body.project_pass) || subjData.project_pass || 0,
            component_type: subjData.component_type || "Theory"
        };

        const maxOrder = await q(
            `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
             FROM erp_exams WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ?`,
            [examId]
        );

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

    await assertExamOpen(examId);

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
        return fail(res, `Cannot remove: ${marks[0].cnt} marks record(s) exist`, 400);
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
    const { section_id, stream_id } = req.query;

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam is locked, marks entry disabled", 400);

    const examSub = await q(`
        SELECT * FROM erp_exams
        WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
        LIMIT 1
    `, [examId, subjectId]);
    if (examSub.length === 0) return fail(res, "Subject not configured for this exam", 404);
    const examSubjectConfig = safeJSONParse(examSub[0].data, {});

    let sql = `
        SELECT ss.student_id, ss.class_id, ss.section_id, ss.stream_id,
               n.name AS student_name, n.father_name, n.mother_name, n.roll_number,
               n.student_photo_url AS photo,
               n.class AS student_class, n.section AS student_section,
               n.stream AS student_stream, n.session AS student_session,
               m.id AS marks_id, m.theory_marks, m.practical_marks,
               m.internal_marks, m.project_marks,
               m.total_marks, m.max_marks, m.grade,
               m.is_absent, m.absent_type, m.remarks,
               m.status AS marks_status
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
    if (stream_id) {
        sql += ` AND ss.stream_id = ?`;
        params.push(parseId(stream_id, "stream_id"));
    }
    sql += ` ORDER BY CAST(n.roll_number AS UNSIGNED) ASC, n.name ASC`;

    const students = await q(sql, params);

    return ok(res, {
        exam: {
            id: exam.id,
            exam_code: exam.exam_code,
            exam_name: exam.name,
            session_id: exam.session_id,
            class_id: exam.class_id,
            status: exam.status,
            is_locked: !!exam.is_locked,
            data: safeJSONParse(exam.data, {})
        },
        subject_config: examSubjectConfig,
        students
    }, students.length === 0
        ? "No students found. Assign subjects manually first."
        : "Marks entry data fetched successfully");
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
    if (exam.status === "PUBLISHED") return fail(res, "Exam is published, cannot modify", 400);

    const examSub = await q(`
        SELECT * FROM erp_exams
        WHERE record_type = 'EXAM_SUBJECT' AND exam_id = ? AND subject_id = ?
        LIMIT 1
    `, [examId, subjectId]);
    if (examSub.length === 0) return fail(res, "Subject not configured for this exam", 400);

    const cfg = safeJSONParse(examSub[0].data, {});
    let theoryMax = toFloatSafe(cfg.theory_max);
    const practicalMax = toFloatSafe(cfg.practical_max);
    const internalMax = toFloatSafe(cfg.internal_max);
    const projectMax = toFloatSafe(cfg.project_max);
    const maxMarks = toFloatSafe(cfg.max_marks) || (theoryMax + practicalMax + internalMax + projectMax) || 100;

    if (theoryMax + practicalMax + internalMax + projectMax === 0) theoryMax = maxMarks;

    const saved = [], failed = [], skipped = [];

    for (const item of marksList) {
        try {
            const studentId = String(item.student_id || "").trim();
            if (!studentId) throw new Error("student_id missing");

            const assigned = await q(`
                SELECT id, section_id, stream_id FROM erp_marks
                WHERE record_type = 'STUDENT_SUBJECT'
                  AND student_id = ? AND session_id = ? AND class_id = ?
                  AND subject_id = ? AND status = 'ACTIVE'
                LIMIT 1
            `, [studentId, exam.session_id, exam.class_id, subjectId]);
            if (assigned.length === 0) throw new Error(`Student ${studentId} not assigned to this subject`);

            const absentType = item.absent_type || "Present";
            if (!ABSENT_TYPES.includes(absentType)) {
                throw new Error(`Invalid absent_type: ${absentType}`);
            }
            const isAbsent = absentType !== "Present";

            const theory = isAbsent ? null : parseMark(item.theory, "Theory", theoryMax);
            const practical = isAbsent ? null : parseMark(item.practical, "Practical", practicalMax);
            const internal = isAbsent ? null : parseMark(item.internal, "Internal", internalMax);
            const project = isAbsent ? null : parseMark(item.project, "Project", projectMax);

            if (!isAbsent && theory === null && practical === null && internal === null && project === null) {
                skipped.push(studentId);
                continue;
            }

            const total = isAbsent ? 0 : (theory || 0) + (practical || 0) + (internal || 0) + (project || 0);
            if (total > maxMarks) throw new Error(`Total ${total} exceeds maximum ${maxMarks}`);

            const pct = maxMarks > 0 ? (total / maxMarks) * 100 : 0;
            const grade = isAbsent ? "AB" : await calculateGrade(pct);

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
                    entity_id: existing[0].id, student_id: studentId,
                    session_id: exam.session_id, exam_id: examId, subject_id: subjectId, user,
                    old_value: existing[0],
                    new_value: { theory, practical, internal, project, total, grade, absentType }
                });
            } else {
                const result = await q(`
                    INSERT INTO erp_marks (
                        record_type, student_id, session_id, class_id, section_id, stream_id,
                        exam_id, subject_id,
                        theory_marks, practical_marks, internal_marks, project_marks,
                        total_marks, max_marks, grade, is_absent, absent_type, remarks,
                        status, entered_by, created_at
                    ) VALUES ('MARKS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())
                `, [
                    studentId, exam.session_id, exam.class_id,
                    assigned[0].section_id, assigned[0].stream_id,
                    examId, subjectId,
                    theory, practical, internal, project,
                    total, maxMarks, grade, isAbsent ? 1 : 0, absentType, remarks,
                    user.user_id
                ]);

                await auditLog({
                    action: "MARKS_CREATED", entity_type: "MARKS",
                    entity_id: result.insertId, student_id: studentId,
                    session_id: exam.session_id, exam_id: examId, subject_id: subjectId, user,
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

    log.success("Marks saved", { examId, subjectId, saved: saved.length, failed: failed.length });

    if (saved.length === 0 && failed.length > 0) {
        return fail(res, `No marks saved, ${failed.length} failed`, 400, { data: { failed } });
    }

    return ok(res, {
        saved_count: saved.length,
        failed_count: failed.length,
        skipped_count: skipped.length,
        saved, failed, skipped
    }, `${saved.length} marks saved, ${failed.length} failed, ${skipped.length} skipped`);
}));

router.post("/marks/submit", asyncHandler(async (req, res) => {
    requireFields(req.body, ["exam_id", "subject_id"]);
    const user = getUserContext(req);

    const examId = parseId(req.body.exam_id, "exam_id");
    const subjectId = parseId(req.body.subject_id, "subject_id");
    await assertExamOpen(examId);

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

router.post("/marks/verify", requireRole(...ADMIN_ROLES, "TEACHER", "HOD"), asyncHandler(async (req, res) => {
    requireFields(req.body, ["exam_id", "subject_id"]);
    const user = getUserContext(req);

    const examId = parseId(req.body.exam_id, "exam_id");
    const subjectId = parseId(req.body.subject_id, "subject_id");
    await assertExamOpen(examId);

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
    await assertExamOpen(examId);

    const result = await q(`
        UPDATE erp_marks
        SET status = 'DRAFT',
            remarks = LEFT(CONCAT(COALESCE(remarks, ''), ' | RETURNED: ', ?), 500),
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

router.post("/exams/:id/finalize", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.is_locked) return fail(res, "Exam already finalized", 400);

    const total = await q(
        `SELECT COUNT(*) AS cnt FROM erp_marks WHERE record_type = 'MARKS' AND exam_id = ?`,
        [examId]
    );
    if (total[0].cnt === 0) return fail(res, "No marks entered for this exam", 400);

    const pending = await q(`
        SELECT COUNT(*) AS cnt FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
          AND status NOT IN ('VERIFIED', 'FINALIZED')
    `, [examId]);
    if (pending[0].cnt > 0) {
        return fail(res, `${pending[0].cnt} marks are not verified yet`, 400);
    }

    if (!req.body?.force) {
        const missing = await q(`
            SELECT COUNT(*) AS cnt
            FROM erp_marks ss
            JOIN erp_exams es ON es.record_type = 'EXAM_SUBJECT'
                AND es.exam_id = ? AND es.subject_id = ss.subject_id
            LEFT JOIN erp_marks m ON m.record_type = 'MARKS'
                AND m.exam_id = ? AND m.student_id = ss.student_id AND m.subject_id = ss.subject_id
            WHERE ss.record_type = 'STUDENT_SUBJECT'
              AND ss.session_id = ? AND ss.class_id = ? AND ss.status = 'ACTIVE'
              AND m.id IS NULL
        `, [examId, examId, exam.session_id, exam.class_id]);
        if (missing[0].cnt > 0) {
            return fail(res,
                `${missing[0].cnt} student-subject marks are still missing. Enter them, or send force:true to finalize anyway.`,
                400);
        }
    }

    const students = await q(`
        SELECT DISTINCT student_id FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
    `, [examId]);

    let snapshots = 0;
    const snapFailed = [];
    for (const s of students) {
        try {
            await snapshotMarks({
                student_id: s.student_id,
                session_id: exam.session_id,
                exam_id: examId,
                reason: "FINALIZED",
                user
            });
            const n = await snapshotResult({
                student_id: s.student_id,
                session_id: exam.session_id,
                class_id: exam.class_id,
                exam_id: examId,
                result_type: "EXAM",
                reason: "FINALIZED",
                user
            });
            if (n === 0) snapFailed.push({ student_id: s.student_id, error: "Student record not found in Nstudent" });
            else snapshots++;
        } catch (err) {
            log.error("Snapshot failed", { student_id: s.student_id, error: err.message });
            snapFailed.push({ student_id: s.student_id, error: err.message });
        }
    }

    if (snapFailed.length > 0) {
        return fail(res, `Finalize aborted: ${snapFailed.length} snapshot(s) failed`, 500, { data: { failed: snapFailed } });
    }

    await q(`
        UPDATE erp_exams
        SET status = 'FINALIZED', is_locked = 1, updated_by = ?, updated_at = NOW()
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

    log.success("Exam finalized", { examId, snapshots });
    return ok(res, { snapshots, total_students: students.length }, "Exam finalized successfully");
}));

router.post("/exams/:id/unlock", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
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
    if (exam.status !== "FINALIZED") {
        return fail(res, "Only finalized exams can be unlocked", 400);
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

    return ok(res, null, "Exam unlocked. Use /marks/return-for-correction to make marks editable.");
}));





// ============================================================
// SECTION 12: PUBLISH / UNPUBLISH
// ============================================================

router.post("/exams/:id/publish", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
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
        SET status = 'PUBLISHED', result_date = COALESCE(?, result_date, CURDATE()),
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

    log.success("Exam published", { examId });
    return ok(res, { result_date }, "Exam published successfully");
}));

router.post("/exams/:id/unpublish", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const examId = parseId(req.params.id);
    const user = getUserContext(req);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);

    if (examRows[0].status !== "PUBLISHED") {
        return fail(res, "Exam is not published", 400);
    }

    await q(`
        UPDATE erp_exams
        SET status = 'FINALIZED', updated_by = ?, updated_at = NOW()
        WHERE id = ?
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
// SECTION 13: STUDENT SELF-SERVICE (PERMANENT RESULTS)
// ============================================================

router.get("/student/:studentId/permanent", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.query;

    if (!studentId || studentId.trim() === "") {
        return fail(res, "Student ID is required", 400);
    }

    const sid = studentId.trim();

    let student;
    try { student = await getStudentFromNstudent(sid); }
    catch (err) { return fail(res, err.message, err.status || 404); }

    if (student.status && student.status.toLowerCase() === "inactive") {
        return fail(res, "Student account is inactive. Contact school office.", 403);
    }

    const classRow = await resolveClassRow(student.class);
    const classId = classRow?.id || null;

    if (classId) {
        try {
            const publishedExams = await q(`
                SELECT id, session_id, class_id, exam_code, name AS exam_name
                FROM erp_exams
                WHERE record_type = 'EXAM' AND status = 'PUBLISHED' AND class_id = ?
                  ${session_id ? "AND session_id = ?" : ""}
            `, session_id ? [classId, parseId(session_id)] : [classId]);

            const sys = { user_id: "SYSTEM", user_name: "System", user_role: "SYSTEM" };
            for (const exam of publishedExams) {
                const existing = await q(`
                    SELECT id FROM erp_results_backup
                    WHERE student_id = ? AND exam_id = ? AND result_type = 'EXAM'
                    LIMIT 1
                `, [sid, exam.id]);

                if (existing.length === 0) {
                    await snapshotMarks({
                        student_id: sid, session_id: exam.session_id, exam_id: exam.id,
                        reason: "AUTO_ON_VIEW", user: sys
                    });
                    await snapshotResult({
                        student_id: sid, session_id: exam.session_id, class_id: exam.class_id,
                        exam_id: exam.id, result_type: "EXAM", reason: "AUTO_ON_VIEW", user: sys
                    });
                }
            }
        } catch (e) {
            log.warn("Auto-snapshot warning", { error: e.message, sid });
        }
    }

    const resultsRows = await getPublishedResults(sid, session_id || null);

    const results = [];
    for (const r of resultsRows) {
        const marks = await q(`
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
            subject_wise_marks: marks,
            subject_count: marks.length,
            remarks: r.remarks,
            snapshot_at: r.snapshot_at
        });
    }

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
            address: student.address
        },
        results,
        total_results: results.length,
        is_permanent: true
    }, results.length > 0 ? "Results fetched successfully" : "No published result yet");
}));





// ============================================================
// SECTION 14: ADMIN DELETE
// ============================================================

router.delete("/admin/result/:resultId", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
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
        `DELETE FROM erp_marks_backup WHERE student_id = ? AND session_id = ? AND exam_id = ?`,
        [result.student_id, result.session_id, result.exam_id]
    );

    await auditLog({
        action: "RESULT_SNAPSHOT_DELETED", entity_type: "RESULT",
        entity_id: resultId, student_id: result.student_id,
        session_id: result.session_id, exam_id: result.exam_id,
        user, old_value: result, reason: req.body?.reason || "Admin manual delete"
    });

    return ok(res, null, "Result deleted permanently by admin");
}));

router.delete("/admin/student/:studentId/all-results", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
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
        reason: req.body?.reason || "Admin bulk delete",
        old_value: { results_deleted: delResults.affectedRows, marks_deleted: delMarks.affectedRows }
    });

    return ok(res, {
        results_deleted: delResults.affectedRows,
        marks_deleted: delMarks.affectedRows
    }, `All results deleted for student ${sid}`);
}));





// ============================================================
// SECTION 15: STUDENT RESULTS (ADMIN VIEW)
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
// SECTION 17: DASHBOARD & ANALYTICS
// ============================================================

router.get("/dashboard/stats", asyncHandler(async (req, res) => {
    const { session_id } = req.query;
    const sid = session_id ? parseId(session_id) : null;
    const f = sid ? `AND session_id = ${sid}` : "";

    const overall = await q(`
        SELECT
            (SELECT COUNT(DISTINCT student_id) FROM erp_marks
             WHERE record_type = 'STUDENT_SUBJECT' ${f}) AS total_students,
            (SELECT COUNT(*) FROM erp_exams WHERE record_type = 'EXAM' ${f}) AS total_exams,
            (SELECT COUNT(*) FROM erp_exams WHERE record_type = 'EXAM' AND status = 'PUBLISHED' ${f}) AS published_exams,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' ${f}) AS total_marks,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' AND status = 'DRAFT' ${f}) AS draft_marks,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' AND status = 'SUBMITTED' ${f}) AS submitted_marks,
            (SELECT COUNT(*) FROM erp_marks WHERE record_type = 'MARKS' AND status = 'VERIFIED' ${f}) AS verified_marks,
            (SELECT COUNT(*) FROM erp_results_backup WHERE result_type = 'EXAM' AND result_status = 'Pass' ${f}) AS pass_count,
            (SELECT COUNT(*) FROM erp_results_backup WHERE result_type = 'EXAM' AND result_status = 'Fail' ${f}) AS fail_count
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
            SUM(m.is_absent) AS absent_count,
            AVG(CASE WHEN m.is_absent = 0 THEN m.total_marks END) AS avg_marks,
            MAX(CASE WHEN m.is_absent = 0 THEN m.total_marks END) AS highest,
            MIN(CASE WHEN m.is_absent = 0 THEN m.total_marks END) AS lowest
        FROM erp_marks m
        LEFT JOIN erp_master sub ON sub.id = m.subject_id
        WHERE m.record_type = 'MARKS' AND m.exam_id = ?
        GROUP BY m.subject_id, sub.name
    `, [examId]);

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

router.get("/audit-logs", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const { action, student_id, exam_id, entity_type, from_date, to_date } = req.query;
    const { page, limit, offset } = parsePagination(req.query);

    const where = [];
    const params = [];

    if (action) { where.push("action = ?"); params.push(action); }
    if (student_id) { where.push("student_id = ?"); params.push(student_id); }
    if (exam_id) { where.push("exam_id = ?"); params.push(parseId(exam_id)); }
    if (entity_type) { where.push("entity_type = ?"); params.push(entity_type); }
    if (from_date) { where.push("created_at >= ?"); params.push(from_date); }
    if (to_date) {
        where.push("created_at <= ?");
        params.push(String(to_date).length <= 10 ? `${to_date} 23:59:59` : to_date);
    }

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
// SECTION 21: PUBLIC ROUTES (only PUBLISHED results)
// ============================================================
// NOTE: mount these WITHOUT auth middleware in app.js:
//   app.use("/api/results/public", publicRouter)
// ============================================================

async function isExamPublished(examId) {
    const rows = await q(
        `SELECT id, status FROM erp_exams
         WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (rows.length === 0) return false;
    return rows[0].status === "PUBLISHED";
}

async function getPublishedResults(studentId, sessionId = null) {
    let sql = `
        SELECT r.* FROM erp_results_backup r
        INNER JOIN erp_exams e ON e.id = r.exam_id AND e.record_type = 'EXAM'
        WHERE r.student_id = ?
          AND r.result_type = 'EXAM'
          AND e.status = 'PUBLISHED'
    `;
    const params = [studentId];
    if (sessionId) {
        sql += " AND r.session_id = ?";
        params.push(parseId(sessionId));
    }
    sql += " ORDER BY r.session_id DESC, r.exam_id ASC";

    return await q(sql, params);
}

async function getBackupMarks(studentId, sessionId, examId) {
    return q(`
        SELECT subject_id, subject_name,
               theory_marks, practical_marks, internal_marks, project_marks,
               total_marks, max_marks, grade, is_absent, absent_type, remarks
        FROM erp_marks_backup
        WHERE student_id = ? AND session_id = ? AND exam_id = ?
        ORDER BY subject_id ASC
    `, [studentId, sessionId, examId]);
}

router.post("/public/lookup", asyncHandler(async (req, res) => {
    requireFields(req.body, ["roll_number", "dob"]);
    const { roll_number, dob, class: cls, session: sess } = req.body;

    const roll = String(roll_number).trim();
    const dobStr = String(dob).trim();

    if (isNaN(Date.parse(dobStr))) return fail(res, "Invalid date of birth", 400);

    let sql = `
        SELECT student_id, name, father_name, mother_name, dob,
               class, section, stream, session, roll_number, admission_number,
               student_photo_url AS photo, status
        FROM Nstudent
        WHERE LOWER(roll_number) = LOWER(?) AND DATE(dob) = DATE(?)
    `;
    const params = [roll, dobStr];
    if (cls) { sql += ` AND LOWER(class) = LOWER(?)`; params.push(String(cls).trim()); }
    if (sess) { sql += ` AND session = ?`; params.push(String(sess).trim()); }
    sql += ` LIMIT 5`;

    const students = await q(sql, params);
    if (students.length === 0) {
        return fail(res, "No student found with the provided details", 404);
    }
    if (students.length > 1) {
        return fail(res, "Multiple students match. Please also provide class and session.", 409);
    }

    const student = students[0];
    if (student.status && student.status.toLowerCase() === "inactive") {
        return fail(res, "Student account is inactive", 403);
    }

    const results = await getPublishedResults(student.student_id);

    const finalResults = [];
    for (const r of results) {
        const marks = await getBackupMarks(student.student_id, r.session_id, r.exam_id);
        finalResults.push({
            result_id: r.id,
            exam_id: r.exam_id,
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
            failed_subjects: safeJSONParse(r.failed_subjects, []),
            subject_wise_marks: marks,
            snapshot_at: r.snapshot_at
        });
    }

    return ok(res, {
        student: {
            student_id: student.student_id,
            name: student.name,
            father_name: student.father_name,
            class: student.class,
            section: student.section,
            stream: student.stream,
            roll_number: student.roll_number,
            dob: student.dob,
            photo: student.photo
        },
        results: finalResults,
        total_results: finalResults.length
    }, finalResults.length > 0 ? "Results fetched successfully" : "No published result yet");
}));

router.post("/public/search", asyncHandler(async (req, res) => {
    requireFields(req.body, ["student_id", "dob"]);
    const { student_id, dob, session_id } = req.body;

    if (isNaN(Date.parse(String(dob)))) return fail(res, "Invalid date of birth", 400);

    const students = await q(`
        SELECT student_id, name, father_name, mother_name, dob,
               class, section, stream, session, roll_number,
               student_photo_url AS photo, status
        FROM Nstudent
        WHERE student_id = ? AND DATE(dob) = DATE(?)
        LIMIT 1
    `, [student_id, dob]);

    if (students.length === 0) return fail(res, "No student found", 404);

    const student = students[0];
    if (student.status && student.status.toLowerCase() === "inactive") {
        return fail(res, "Student account is inactive", 403);
    }

    const results = await getPublishedResults(student.student_id, session_id || null);

    const formatted = results.map(r => ({
        exam_name: r.exam_name,
        session_name: r.session_name,
        class_name: r.class_name,
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
            roll_number: student.roll_number,
            photo: student.photo
        },
        results: formatted,
        total: formatted.length
    }, "Results fetched successfully");
}));

router.get("/public/classes-list", asyncHandler(async (req, res) => {
    const rows = await q(`
        SELECT master_key AS class_name, name
        FROM erp_master
        WHERE master_type = 'CLASS' AND is_active = 1
        ORDER BY display_order ASC
    `);
    return ok(res, rows, "Classes fetched successfully");
}));

router.get("/public/sessions-list", asyncHandler(async (req, res) => {
    const rows = await q(`
        SELECT id, master_key AS session_code, name AS session_name, is_current
        FROM erp_master
        WHERE master_type = 'SESSION' AND is_active = 1
        ORDER BY display_order DESC, id DESC
    `);
    return ok(res, rows, "Sessions fetched successfully");
}));

router.get("/public/verify/:studentId/:examId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const examId = parseId(req.params.examId, "examId");

    const published = await isExamPublished(examId);
    if (!published) {
        return ok(res, {
            verified: false,
            message: "This exam's result has not been published yet"
        }, "Verification failed");
    }

    const rows = await q(`
        SELECT r.student_name, r.roll_number, r.class_name, r.section_name, r.stream,
               r.session_name, r.exam_name, r.result_status, r.percentage,
               r.overall_grade, r.snapshot_at
        FROM erp_results_backup r
        INNER JOIN erp_exams e ON e.id = r.exam_id AND e.record_type = 'EXAM'
        WHERE r.student_id = ?
          AND r.exam_id = ?
          AND r.result_type = 'EXAM'
          AND e.status = 'PUBLISHED'
        LIMIT 1
    `, [studentId, examId]);

    if (rows.length === 0) {
        return ok(res, {
            verified: false,
            message: "No published result found for verification"
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

router.get("/public/result/:studentId/:examId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const examId = parseId(req.params.examId, "examId");

    const published = await isExamPublished(examId);
    if (!published) {
        return fail(res, "This exam's result is not published yet", 403);
    }

    const dobQ = String(req.query.dob || "").trim();
    if (!dobQ || isNaN(Date.parse(dobQ))) {
        return fail(res, "dob (YYYY-MM-DD) query parameter is required", 400);
    }
    const who = await q(
        `SELECT student_id FROM Nstudent WHERE student_id = ? AND DATE(dob) = DATE(?) LIMIT 1`,
        [studentId, dobQ]
    );
    if (who.length === 0) return fail(res, "Result not found", 404);

    const rows = await q(`
        SELECT * FROM erp_results_backup
        WHERE student_id = ? AND exam_id = ? AND result_type = 'EXAM'
        LIMIT 1
    `, [studentId, examId]);

    if (rows.length === 0) {
        return fail(res, "Result not found", 404);
    }

    const r = rows[0];
    const marks = await getBackupMarks(studentId, r.session_id, examId);

    return ok(res, {
        student: {
            student_id: r.student_id,
            name: r.student_name,
            admission_number: r.admission_number,
            father_name: r.father_name,
            mother_name: r.mother_name,
            dob: r.dob,
            gender: r.gender,
            category: r.category,
            class: r.class_name,
            section: r.section_name,
            stream: r.stream,
            roll_number: r.roll_number,
            session: r.session_name,
            photo: r.photo_url
        },
        exam: {
            exam_id: r.exam_id,
            exam_name: r.exam_name,
            session_name: r.session_name
        },
        result: {
            grand_total: r.grand_total,
            max_total: r.max_total,
            percentage: r.percentage,
            overall_grade: r.overall_grade,
            result_status: r.result_status,
            failed_subjects: safeJSONParse(r.failed_subjects, []),
            subject_wise_marks: marks,
            snapshot_at: r.snapshot_at
        }
    }, "Published result fetched successfully");
}));

router.get("/public/class/:classId/results", asyncHandler(async (req, res) => {
    const classId = parseId(req.params.classId, "classId");
    const { session_id, exam_id } = req.query;

    let sql = `
        SELECT r.* FROM erp_results_backup r
        INNER JOIN erp_exams e ON e.id = r.exam_id AND e.record_type = 'EXAM'
        WHERE r.class_id = ?
          AND r.result_type = 'EXAM'
          AND e.status = 'PUBLISHED'
    `;
    const params = [classId];

    if (session_id) { sql += " AND r.session_id = ?"; params.push(parseId(session_id)); }
    if (exam_id) { sql += " AND r.exam_id = ?"; params.push(parseId(exam_id)); }
    sql += " ORDER BY r.session_id DESC, r.exam_id ASC, CAST(r.roll_number AS UNSIGNED) ASC";

    const rows = await q(sql, params);

    const results = rows.map(r => ({
        result_id: r.id,
        student_id: r.student_id,
        student_name: r.student_name,
        roll_number: r.roll_number,
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
        snapshot_at: r.snapshot_at
    }));

    return ok(res, {
        class_id: classId,
        results,
        total: results.length
    }, `${results.length} published results found`);
}));





// ============================================================
// SECTION 19: MARKSHEET (print-ready data)
// ============================================================

router.get("/marksheet/:studentId/:examId", asyncHandler(async (req, res, next) => {
    if (req.params.studentId === "bulk") return next();

    const { studentId } = req.params;
    const examId = parseId(req.params.examId, "examId");

    const student = await getStudentFromNstudent(studentId);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.status !== "PUBLISHED" && !isStaff(req)) {
        return fail(res, "Result not published yet", 403);
    }

    const resultRows = await q(`
        SELECT * FROM erp_results_backup
        WHERE student_id = ? AND exam_id = ? AND result_type = 'EXAM'
        LIMIT 1
    `, [studentId, examId]);

    if (resultRows.length === 0) {
        return fail(res, "Result not found. This exam may not be finalized yet.", 404);
    }

    const result = resultRows[0];
    const marks = await getBackupMarks(studentId, result.session_id, examId);
    const session = await getMasterById(result.session_id, "SESSION");

    return ok(res, {
        school: {
            name: "Govt. Sr. Sec. School Shilla",
            address: "Shilla, Teh. Nerwa, Distt. Shimla, HP — 171210",
            affiliation: "Affiliated to HPBOSE"
        },
        student: {
            student_id: student.student_id,
            admission_number: student.admission_number,
            name: student.name,
            father_name: student.father_name,
            mother_name: student.mother_name,
            dob: student.dob,
            gender: student.gender,
            category: student.category,
            class: result.class_name || student.class,
            section: result.section_name || student.section,
            stream: result.stream || student.stream,
            roll_number: result.roll_number || student.roll_number,
            session: result.session_name || student.session,
            photo: student.photo,
            signature: student.signature_url
        },
        exam: {
            id: exam.id,
            code: exam.exam_code,
            name: exam.name,
            exam_type: exam.exam_type,
            exam_session: safeJSONParse(exam.data, {}).exam_session || null,
            start_date: exam.start_date,
            end_date: exam.end_date,
            result_date: exam.result_date
        },
        session: {
            id: session.id,
            code: session.master_key,
            name: session.name
        },
        result: {
            grand_total: result.grand_total,
            max_total: result.max_total,
            percentage: result.percentage,
            overall_grade: result.overall_grade,
            result_status: result.result_status,
            failed_subjects: safeJSONParse(result.failed_subjects, []),
            subject_wise_marks: marks,
            subject_count: marks.length,
            remarks: result.remarks,
            snapshot_at: result.snapshot_at
        }
    }, "Marksheet data fetched successfully");
}));

router.get("/marksheet/bulk/:examId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const { section_id } = req.query;

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    if (exam.status !== "PUBLISHED") {
        return fail(res, "Only published exams can generate bulk marksheets", 400);
    }

    let secName = null;
    if (section_id) {
        const sec = await getMasterById(parseId(section_id, "section_id"), "SECTION");
        secName = sec.master_key;
    }

    const results = await q(`
        SELECT * FROM erp_results_backup
        WHERE exam_id = ? AND result_type = 'EXAM' ${secName ? "AND section_name = ?" : ""}
        ORDER BY CAST(roll_number AS UNSIGNED) ASC, student_name ASC
    `, secName ? [examId, secName] : [examId]);

    const students = [];
    for (const r of results) {
        const marks = await getBackupMarks(r.student_id, r.session_id, examId);
        students.push({
            student_id: r.student_id,
            student_name: r.student_name,
            roll_number: r.roll_number,
            father_name: r.father_name,
            mother_name: r.mother_name,
            class_name: r.class_name,
            section_name: r.section_name,
            stream: r.stream,
            photo_url: r.photo_url,
            grand_total: r.grand_total,
            max_total: r.max_total,
            percentage: r.percentage,
            overall_grade: r.overall_grade,
            result_status: r.result_status,
            failed_subjects: safeJSONParse(r.failed_subjects, []),
            subject_wise_marks: marks
        });
    }

    const session = await getMasterById(exam.session_id, "SESSION");

    return ok(res, {
        school: {
            name: "Govt. Sr. Sec. School Shilla",
            address: "Shilla, Teh. Nerwa, Distt. Shimla, HP — 171210"
        },
        exam: {
            id: exam.id,
            code: exam.exam_code,
            name: exam.name,
            exam_session: safeJSONParse(exam.data, {}).exam_session || null,
            result_date: exam.result_date
        },
        session: { id: session.id, code: session.master_key, name: session.name },
        students,
        total: students.length
    }, `Marksheet data for ${students.length} students fetched`);
}));





// ============================================================
// SECTION 20: FINAL RESULT ANNOUNCEMENT
// ============================================================

router.post("/final-result/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { session_id } = req.body;

    if (!session_id) return fail(res, "session_id is required", 400);

    const sessionId = parseId(session_id);
    const sid = studentId.trim();

    const student = await getStudentFromNstudent(sid);

    const classRow = await resolveClassRow(student.class);
    if (!classRow) return fail(res, `Class "${student.class}" not configured`, 400);

    const exams = await q(`
        SELECT e.* FROM erp_exams e
        WHERE e.record_type = 'EXAM' AND e.session_id = ? AND e.class_id = ?
          AND e.status = 'PUBLISHED'
        ORDER BY e.display_order ASC
    `, [sessionId, classRow.id]);

    if (exams.length === 0) {
        return fail(res, "No published exams found for this session & class", 404);
    }

    const examIds = exams.map(e => e.id);
    const allMarks = await q(`
        SELECT mb.*, e.exam_code, e.name AS exam_name, e.display_order
        FROM erp_marks_backup mb
        LEFT JOIN erp_exams e ON e.id = mb.exam_id
        WHERE mb.student_id = ? AND mb.session_id = ?
          AND mb.exam_id IN (${examIds.map(() => "?").join(",")})
        ORDER BY e.display_order ASC, mb.subject_id ASC
    `, [sid, sessionId, ...examIds]);

    if (allMarks.length === 0) {
        return fail(res, "No marks found for this student", 404);
    }

    const subjectGroups = {};
    for (const m of allMarks) {
        const key = m.subject_id;
        if (!subjectGroups[key]) {
            subjectGroups[key] = {
                subject_id: m.subject_id,
                subject_name: m.subject_name,
                exams: {}
            };
        }
        subjectGroups[key].exams[m.exam_code] = {
            total: parseFloat(m.total_marks) || 0,
            max: parseFloat(m.max_marks) || 0,
            grade: m.grade,
            absent_type: m.absent_type
        };
    }

    const weights = {};
    let weightSum = 0;
    for (const e of exams) {
        const w = toDecimal(safeJSONParse(e.data, {}).weightage_percent);
        if (w) { weights[e.exam_code] = w; weightSum += w; }
    }
    const useWeights = Object.keys(weights).length === exams.length && Math.abs(weightSum - 100) < 0.01;

    const subjectWise = [];
    let grandTotal = 0, maxTotal = 0;
    const failedSubjects = [];

    for (const key in subjectGroups) {
        const sg = subjectGroups[key];
        let subjTotal = 0, subjMax = 0, subjWeighted = 0;
        const examBreakdown = {};

        for (const examCode in sg.exams) {
            const e = sg.exams[examCode];
            subjTotal += e.total;
            subjMax += e.max;
            if (useWeights && e.max > 0) subjWeighted += (e.total / e.max) * weights[examCode];
            examBreakdown[examCode] = e;
        }
        if (useWeights) {
            subjTotal = parseFloat(subjWeighted.toFixed(2));
            subjMax = 100;
        }

        grandTotal += subjTotal;
        maxTotal += subjMax;

        const subjPct = subjMax > 0 ? (subjTotal / subjMax) * 100 : 0;
        const subjGrade = await calculateGrade(subjPct);

        if (subjPct < 33) failedSubjects.push(sg.subject_name);

        subjectWise.push({
            subject_id: sg.subject_id,
            subject_name: sg.subject_name,
            total: subjTotal,
            max: subjMax,
            percentage: parseFloat(subjPct.toFixed(2)),
            grade: subjGrade,
            exam_breakdown: examBreakdown
        });
    }

    const percentage = maxTotal > 0 ? parseFloat(((grandTotal / maxTotal) * 100).toFixed(2)) : 0;
    const overallGrade = await calculateGrade(percentage);

    let resultStatus = "Pass";
    if (failedSubjects.length > 0) resultStatus = "Fail";
    else if (percentage < 33) resultStatus = "Fail";

    return ok(res, {
        student: {
            student_id: student.student_id,
            name: student.name,
            father_name: student.father_name,
            mother_name: student.mother_name,
            dob: student.dob,
            class: student.class,
            section: student.section,
            stream: student.stream,
            roll_number: student.roll_number,
            session: student.session,
            photo: student.photo
        },
        session: { id: sessionId },
        exams: exams.map(e => ({
            id: e.id,
            code: e.exam_code,
            name: e.name,
            weightage_percent: weights[e.exam_code] ?? null,
            exam_session: safeJSONParse(e.data, {}).exam_session || null
        })),
        final_result: {
            grand_total: grandTotal,
            max_total: maxTotal,
            percentage,
            overall_grade: overallGrade,
            result_status: resultStatus,
            failed_subjects: failedSubjects,
            subject_wise: subjectWise,
            subject_count: subjectWise.length,
            weighted: useWeights
        }
    }, "Final result calculated successfully");
}));



// ============================================================
// SECTION 10.5: MARKSHEET VERIFICATION PAGE
// ============================================================

// ------------------------------------------------------------
// GET /marksheet-verify/:examId
// Returns all students with their marks & status for verification
// ------------------------------------------------------------
router.get("/marksheet-verify/:examId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const { section_id } = req.query;

    // Fetch exam info
    const examRows = await q(
        `SELECT e.*, c.master_key AS class_name, s.master_key AS session_code
         FROM erp_exams e
         LEFT JOIN erp_master c ON c.id = e.class_id
         LEFT JOIN erp_master s ON s.id = e.session_id
         WHERE e.id = ? AND e.record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    // Get all students with their aggregated marks for this exam
    let sql = `
        SELECT 
            ss.student_id,
            n.name AS student_name,
            n.father_name,
            n.roll_number,
            n.stream,
            n.class AS student_class,
            n.section AS student_section,
            COUNT(DISTINCT ss.subject_id) AS subject_count,
            SUM(m.total_marks) AS grand_total,
            SUM(m.max_marks) AS max_total,
            GROUP_CONCAT(DISTINCT m.status) AS status_list,
            MIN(m.status) AS marks_status
        FROM erp_marks ss
        JOIN Nstudent n ON n.student_id = ss.student_id
        LEFT JOIN erp_marks m ON m.record_type = 'MARKS'
            AND m.student_id = ss.student_id
            AND m.exam_id = ?
            AND m.subject_id = ss.subject_id
        WHERE ss.record_type = 'STUDENT_SUBJECT'
          AND ss.session_id = ?
          AND ss.class_id = ?
          AND ss.status = 'ACTIVE'
    `;
    const params = [examId, exam.session_id, exam.class_id];

    if (section_id) {
        sql += ` AND ss.section_id = ?`;
        params.push(parseId(section_id, "section_id"));
    }
    sql += ` GROUP BY ss.student_id, n.name, n.father_name, n.roll_number, n.stream, n.class, n.section
             ORDER BY CAST(n.roll_number AS UNSIGNED) ASC, n.name ASC`;

    const rows = await q(sql, params);

    // Compute aggregate status per student
    const students = rows.map(r => {
        let marks_status = "DRAFT";
        if (r.status_list) {
            const statuses = r.status_list.split(",");
            if (statuses.every(s => s === "PUBLISHED")) marks_status = "PUBLISHED";
            else if (statuses.every(s => ["FINALIZED", "PUBLISHED"].includes(s))) marks_status = "FINALIZED";
            else if (statuses.every(s => s === "VERIFIED")) marks_status = "VERIFIED";
            else if (statuses.some(s => s === "SUBMITTED")) marks_status = "SUBMITTED";
            else if (statuses.some(s => s === "IN_PROGRESS")) marks_status = "IN_PROGRESS";
            else marks_status = "DRAFT";
        }

        const totalObtained = parseFloat(r.grand_total) || 0;
        const totalMax = parseFloat(r.max_total) || 0;
        const pct = totalMax > 0 ? ((totalObtained / totalMax) * 100) : 0;

        let grade = "E";
        if (pct >= 90) grade = "A+";
        else if (pct >= 80) grade = "A";
        else if (pct >= 70) grade = "B+";
        else if (pct >= 60) grade = "B";
        else if (pct >= 50) grade = "C";
        else if (pct >= 40) grade = "D";

        return {
            student_id: r.student_id,
            student_name: r.student_name,
            father_name: r.father_name,
            roll_number: r.roll_number,
            stream: r.stream,
            class_name: r.student_class,
            section: r.student_section,
            subject_count: r.subject_count,
            grand_total: totalObtained,
            max_total: totalMax,
            percentage: parseFloat(pct.toFixed(2)),
            overall_grade: grade,
            marks_status,
            status_list: r.status_list
        };
    });

    return ok(res, {
        exam: {
            id: exam.id,
            name: exam.name,
            exam_code: exam.exam_code,
            status: exam.status,
            is_locked: !!exam.is_locked,
            class_name: exam.class_name,
            session_code: exam.session_code
        },
        students,
        total: students.length
    }, `${students.length} student(s) loaded for verification`);
}));

// ------------------------------------------------------------
// POST /marks-verify-student/:examId/:studentId
// Verify all marks of a single student in this exam
// ------------------------------------------------------------
router.post("/marks-verify-student/:examId/:studentId", requireRole(...ADMIN_ROLES, "TEACHER", "HOD"), asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const studentId = String(req.params.studentId).trim();
    const user = getUserContext(req);

    const exam = await assertExamOpen(examId);

    const result = await q(`
        UPDATE erp_marks
        SET status = 'VERIFIED', verified_by = ?, verified_at = NOW(), updated_at = NOW()
        WHERE record_type = 'MARKS'
          AND exam_id = ? AND student_id = ?
          AND status IN ('SUBMITTED', 'DRAFT', 'IN_PROGRESS')
    `, [user.user_id, examId, studentId]);

    if (result.affectedRows === 0) {
        return fail(res, "No marks to verify (already verified or finalised)", 400);
    }

    // If all marks of this exam are now verified, update exam status
    const pending = await q(`
        SELECT COUNT(*) AS cnt FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
          AND status NOT IN ('VERIFIED', 'FINALIZED', 'PUBLISHED')
    `, [examId]);

    if (pending[0].cnt === 0) {
        await q(`UPDATE erp_exams SET status = 'VERIFIED' WHERE id = ? AND status NOT IN ('FINALIZED', 'PUBLISHED')`, [examId]);
    }

    await auditLog({
        action: "MARKS_VERIFIED_STUDENT",
        entity_type: "MARKS",
        exam_id: examId,
        student_id: studentId,
        user,
        new_value: { verified_count: result.affectedRows }
    });

    return ok(res, { verified: result.affectedRows }, `Marks verified for student ${studentId}`);
}));

// ------------------------------------------------------------
// POST /marks-return-student/:examId/:studentId
// Send all marks of a single student back for correction
// ------------------------------------------------------------
router.post("/marks-return-student/:examId/:studentId", requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const studentId = String(req.params.studentId).trim();
    const user = getUserContext(req);
    requireFields(req.body, ["reason"]);
    const reason = trimStr(req.body.reason, 500);

    await assertExamOpen(examId);

    const result = await q(`
        UPDATE erp_marks
        SET status = 'DRAFT',
            remarks = LEFT(CONCAT(COALESCE(remarks, ''), ' | RETURNED: ', ?), 500),
            updated_at = NOW()
        WHERE record_type = 'MARKS'
          AND exam_id = ? AND student_id = ?
          AND status IN ('SUBMITTED', 'VERIFIED')
    `, [reason, examId, studentId]);

    if (result.affectedRows === 0) {
        return fail(res, "No marks to return (already in draft or finalised)", 400);
    }

    // Set exam back to IN_PROGRESS
    await q(`UPDATE erp_exams SET status = 'IN_PROGRESS' WHERE id = ? AND status NOT IN ('FINALIZED', 'PUBLISHED', 'DRAFT')`, [examId]);

    await auditLog({
        action: "MARKS_RETURNED_STUDENT",
        entity_type: "MARKS",
        exam_id: examId,
        student_id: studentId,
        user,
        reason,
        new_value: { returned_count: result.affectedRows }
    });

    return ok(res, { returned: result.affectedRows }, `Marks returned for student ${studentId}`);
}));

// ------------------------------------------------------------
// GET /marksheet-verify/summary/:examId
// Optional: aggregate verification summary
// ------------------------------------------------------------
router.get("/marksheet-verify/summary/:examId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");

    const rows = await q(`
        SELECT status, COUNT(*) AS cnt
        FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ?
        GROUP BY status
    `, [examId]);

    const summary = {
        DRAFT: 0,
        IN_PROGRESS: 0,
        SUBMITTED: 0,
        VERIFIED: 0,
        FINALIZED: 0,
        PUBLISHED: 0
    };
    rows.forEach(r => { summary[r.status] = r.cnt; });

    return ok(res, summary, "Verification summary");
}));


// ============================================================
// SECTION 10.6: FULL MARKSHEET VERIFICATION
// ============================================================

// ------------------------------------------------------------
// GET /marksheet-verify-full/:examId
// Returns students with subject-wise marks (theory/practical/internal)
// with max marks for each, plus stream filter
// ------------------------------------------------------------
router.get("/marksheet-verify-full/:examId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const { section_id, stream } = req.query;

    // Fetch exam info
    const examRows = await q(
        `SELECT e.*, c.master_key AS class_name, s.master_key AS session_code
         FROM erp_exams e
         LEFT JOIN erp_master c ON c.id = e.class_id
         LEFT JOIN erp_master s ON s.id = e.session_id
         WHERE e.id = ? AND e.record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    // Fetch all exam subjects with their configs
    const examSubjects = await q(`
        SELECT es.id AS exam_subject_id, es.subject_id,
               es.data AS exam_subject_data, es.display_order,
               sub.master_key AS subject_code, sub.name AS subject_name,
               sub.data AS subject_data
        FROM erp_exams es
        LEFT JOIN erp_master sub ON sub.id = es.subject_id
        WHERE es.record_type = 'EXAM_SUBJECT' AND es.exam_id = ?
        ORDER BY es.display_order ASC
    `, [examId]);

    // Build subject list with max marks (from exam_subject config, fallback to subject master)
    const subjects = examSubjects.map(es => {
        const esc = safeJSONParse(es.exam_subject_data, {});
        const sc = safeJSONParse(es.subject_data, {});
        const merged = { ...sc, ...esc };
        return {
            id: es.subject_id,
            subject_code: es.subject_code,
            subject_name: es.subject_name,
            theory_max: parseInt(merged.theory_max) || 0,
            theory_pass: parseInt(merged.theory_pass) || 0,
            practical_max: parseInt(merged.practical_max) || 0,
            practical_pass: parseInt(merged.practical_pass) || 0,
            internal_max: parseInt(merged.internal_max) || 0,
            internal_pass: parseInt(merged.internal_pass) || 0,
            project_max: parseInt(merged.project_max) || 0,
            project_pass: parseInt(merged.project_pass) || 0,
            total_max: parseInt(merged.max_marks) || parseInt(merged.total_max) || 100,
            total_pass: parseInt(merged.pass_marks) || parseInt(merged.total_pass) || 33
        };
    });

    // Fetch students with subject-wise marks
    let studentSql = `
        SELECT ss.student_id, ss.section_id, ss.stream_id,
               n.name AS student_name, n.father_name, n.roll_number,
               n.stream, n.class AS student_class, n.section AS student_section
        FROM erp_marks ss
        JOIN Nstudent n ON n.student_id = ss.student_id
        WHERE ss.record_type = 'STUDENT_SUBJECT'
          AND ss.session_id = ?
          AND ss.class_id = ?
          AND ss.status = 'ACTIVE'
    `;
    const studentParams = [exam.session_id, exam.class_id];

    if (section_id) {
        studentSql += ` AND ss.section_id = ?`;
        studentParams.push(parseId(section_id, "section_id"));
    }
    if (stream) {
        studentSql += ` AND LOWER(n.stream) = LOWER(?)`;
        studentParams.push(String(stream).trim());
    }
    studentSql += ` GROUP BY ss.student_id, ss.section_id, ss.stream_id, n.name, n.father_name, n.roll_number, n.stream, n.class, n.section
                    ORDER BY CAST(n.roll_number AS UNSIGNED) ASC, n.name ASC`;

    const studentRows = await q(studentSql, studentParams);

    if (studentRows.length === 0) {
        return ok(res, {
            exam: {
                id: exam.id,
                name: exam.name,
                exam_code: exam.exam_code,
                status: exam.status,
                is_locked: !!exam.is_locked,
                class_name: exam.class_name,
                session_code: exam.session_code
            },
            subjects,
            students: [],
            total: 0
        }, "No students found");
    }

    // Fetch all marks for this exam in one query
    const studentIds = studentRows.map(s => s.student_id);
    const marksRows = await q(`
        SELECT student_id, subject_id,
               theory_marks, practical_marks, internal_marks, project_marks,
               total_marks, max_marks, grade, is_absent, absent_type, status
        FROM erp_marks
        WHERE record_type = 'MARKS'
          AND exam_id = ?
          AND student_id IN (${studentIds.map(() => "?").join(",")})
    `, [examId, ...studentIds]);

    // Group marks by student -> subject
    const marksMap = {};
    marksRows.forEach(m => {
        if (!marksMap[m.student_id]) marksMap[m.student_id] = {};
        marksMap[m.student_id][m.subject_id] = m;
    });

    // Build student objects
    const students = studentRows.map(s => {
        const studentMarks = marksMap[s.student_id] || {};

        // Compute totals
        let grandTotal = 0, maxTotal = 0;
        let statuses = [];
        Object.values(studentMarks).forEach(m => {
            grandTotal += parseFloat(m.total_marks) || 0;
            maxTotal += parseFloat(m.max_marks) || 0;
            if (m.status) statuses.push(m.status);
        });

        const pct = maxTotal > 0 ? (grandTotal / maxTotal) * 100 : 0;
        let grade = "E";
        if (pct >= 90) grade = "A+";
        else if (pct >= 80) grade = "A";
        else if (pct >= 70) grade = "B+";
        else if (pct >= 60) grade = "B";
        else if (pct >= 50) grade = "C";
        else if (pct >= 40) grade = "D";

        // Determine aggregate status
        let marks_status = "DRAFT";
        if (statuses.length > 0) {
            if (statuses.every(s => s === "PUBLISHED")) marks_status = "PUBLISHED";
            else if (statuses.every(s => ["FINALIZED", "PUBLISHED"].includes(s))) marks_status = "FINALIZED";
            else if (statuses.every(s => s === "VERIFIED")) marks_status = "VERIFIED";
            else if (statuses.some(s => s === "SUBMITTED")) marks_status = "SUBMITTED";
            else if (statuses.some(s => s === "IN_PROGRESS")) marks_status = "IN_PROGRESS";
            else marks_status = "DRAFT";
        }

        return {
            student_id: s.student_id,
            student_name: s.student_name,
            father_name: s.father_name,
            roll_number: s.roll_number,
            stream: s.stream,
            section: s.student_section,
            class_name: s.student_class,
            subject_marks: studentMarks,
            grand_total: grandTotal,
            max_total: maxTotal,
            percentage: parseFloat(pct.toFixed(2)),
            overall_grade: grade,
            marks_status
        };
    });

    return ok(res, {
        exam: {
            id: exam.id,
            name: exam.name,
            exam_code: exam.exam_code,
            status: exam.status,
            is_locked: !!exam.is_locked,
            class_name: exam.class_name,
            session_code: exam.session_code
        },
        subjects,
        students,
        total: students.length
    }, `${students.length} student(s) loaded`);
}));

// ------------------------------------------------------------
// GET /marksheet-verify-details/:examId/:studentId
// Full detail for a single student — subject-wise with max/pass marks
// ------------------------------------------------------------
router.get("/marksheet-verify-details/:examId/:studentId", asyncHandler(async (req, res) => {
    const examId = parseId(req.params.examId, "examId");
    const studentId = String(req.params.studentId).trim();

    const student = await getStudentFromNstudent(studentId);

    const examRows = await q(
        `SELECT * FROM erp_exams WHERE id = ? AND record_type = 'EXAM' LIMIT 1`,
        [examId]
    );
    if (examRows.length === 0) return fail(res, "Exam not found", 404);
    const exam = examRows[0];

    // Fetch exam subjects
    const examSubjects = await q(`
        SELECT es.subject_id, es.data AS exam_subject_data,
               sub.name AS subject_name, sub.master_key AS subject_code,
               sub.data AS subject_data
        FROM erp_exams es
        LEFT JOIN erp_master sub ON sub.id = es.subject_id
        WHERE es.record_type = 'EXAM_SUBJECT' AND es.exam_id = ?
        ORDER BY es.display_order ASC
    `, [examId]);

    // Fetch this student's marks
    const marksRows = await q(`
        SELECT subject_id, theory_marks, practical_marks, internal_marks, project_marks,
               total_marks, max_marks, grade, is_absent, absent_type, remarks, status
        FROM erp_marks
        WHERE record_type = 'MARKS' AND exam_id = ? AND student_id = ?
    `, [examId, studentId]);

    const marksMap = {};
    marksRows.forEach(m => { marksMap[m.subject_id] = m; });

    // Merge subject config + marks
    const subjectMarks = examSubjects.map(es => {
        const ec = safeJSONParse(es.exam_subject_data, {});
        const sc = safeJSONParse(es.subject_data, {});
        const merged = { ...sc, ...ec };
        const mark = marksMap[es.subject_id] || {};

        return {
            subject_id: es.subject_id,
            subject_name: es.subject_name,
            subject_code: es.subject_code,
            theory_max: parseInt(merged.theory_max) || 0,
            theory_pass: parseInt(merged.theory_pass) || 0,
            practical_max: parseInt(merged.practical_max) || 0,
            practical_pass: parseInt(merged.practical_pass) || 0,
            internal_max: parseInt(merged.internal_max) || 0,
            internal_pass: parseInt(merged.internal_pass) || 0,
            project_max: parseInt(merged.project_max) || 0,
            project_pass: parseInt(merged.project_pass) || 0,
            theory_marks: mark.theory_marks,
            practical_marks: mark.practical_marks,
            internal_marks: mark.internal_marks,
            project_marks: mark.project_marks,
            total_marks: mark.total_marks,
            max_marks: mark.max_marks,
            grade: mark.grade,
            is_absent: mark.is_absent || 0,
            absent_type: mark.absent_type || "Present",
            remarks: mark.remarks,
            status: mark.status || "DRAFT"
        };
    });

    // Compute totals
    let grandTotal = 0, maxTotal = 0;
    let failedSubjects = [];
    subjectMarks.forEach(m => {
        grandTotal += parseFloat(m.total_marks) || 0;
        maxTotal += parseFloat(m.max_marks) || 0;
        if (m.is_absent !== 1 && (parseFloat(m.total_marks) / (parseFloat(m.max_marks) || 1)) < 0.33) {
            failedSubjects.push(m.subject_name);
        }
    });

    const pct = maxTotal > 0 ? (grandTotal / maxTotal) * 100 : 0;
    let grade = "E";
    if (pct >= 90) grade = "A+";
    else if (pct >= 80) grade = "A";
    else if (pct >= 70) grade = "B+";
    else if (pct >= 60) grade = "B";
    else if (pct >= 50) grade = "C";
    else if (pct >= 40) grade = "D";

    const resultStatus = failedSubjects.length > 0 ? "Fail" : (pct >= 33 ? "Pass" : "Fail");

    return ok(res, {
        student: {
            student_id: student.student_id,
            name: student.name,
            father_name: student.father_name,
            mother_name: student.mother_name,
            roll_number: student.roll_number,
            class: student.class,
            section: student.section,
            stream: student.stream,
            dob: student.dob
        },
        exam: {
            id: exam.id,
            name: exam.name,
            exam_code: exam.exam_code,
            status: exam.status
        },
        subject_marks: subjectMarks,
        totals: {
            grand_total: grandTotal,
            max_total: maxTotal,
            percentage: parseFloat(pct.toFixed(2)),
            grade,
            status: resultStatus,
            failed_subjects: failedSubjects
        }
    }, "Student details loaded");
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

    let status = err.status || 500;
    if (err.code === "ER_DUP_ENTRY") status = 409;

    const message = status >= 500 && process.env.NODE_ENV === "production"
        ? "Internal server error"
        : (err.message || "Internal server error");
    return fail(res, message, status);
});

module.exports = router;

// ============================================================
// END OF FILE
// ============================================================
