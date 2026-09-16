// ============================================================
//  RESULT MANAGEMENT ROUTES — Final Production Version
//  ✅ Auto overall status calculation
//  ✅ Subject-wise marks (JSON)
//  ✅ Admin filters (Session, Class, Status)
//  ✅ Public + Student + Admin APIs
//  ✅ Proper error handling order
// ============================================================

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const { cloudinary } = require("../config/cloudinary");

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
    info: (msg, meta = {}) => console.log(`ℹ️  [RESULTS] ${msg}`, Object.keys(meta).length ? meta : ""),
    warn: (msg, meta = {}) => console.warn(`⚠️  [RESULTS] ${msg}`, Object.keys(meta).length ? meta : ""),
    error: (msg, meta = {}) => console.error(`❌ [RESULTS] ${msg}`, Object.keys(meta).length ? meta : ""),
    success: (msg, meta = {}) => console.log(`✅ [RESULTS] ${msg}`, Object.keys(meta).length ? meta : "")
};

// ============================================================
// CONSTANTS
// ============================================================

const VALID_CLASSES = [
    "Nursery", "LKG", "UKG",
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"
];

const VALID_EXAM_TYPES = [
    "Annual Examination",
    "Half Yearly Examination",
    "Pre Board",
    "Board Examination",
    "Final Examination",
    "Monthly Test",
    "Unit Test"
];

const VALID_RESULT_STATUSES = [
    "Pass", "Fail", "Compartment", "Supply", "Absent", "Withheld"
];

const STATUS_PRIORITY = {
    "Pass": 1,
    "Compartment": 2,
    "Supply": 3,
    "Fail": 4,
    "Absent": 5,
    "Withheld": 6
};

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 200;

// ============================================================
// HELPERS
// ============================================================

function normalizeSession(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
}

function getSessionVariants(session) {
    if (!session) return [];
    const variants = [session];
    const m = session.match(/^(\d{4})-(\d{2})$/);
    if (m) {
        const fullEndYear = 2000 + parseInt(m[2], 10);
        variants.push(`March-${fullEndYear}`, `December-${fullEndYear}`);
    }
    return variants;
}

function normalizeClass(v, { required = false } = {}) {
    if (v === undefined || v === null || String(v).trim() === "") {
        if (required) throw new Error("Class is required");
        return null;
    }
    const s = String(v).trim();
    if (!VALID_CLASSES.includes(s)) {
        throw new Error(`Invalid class. Allowed: ${VALID_CLASSES.join(", ")}`);
    }
    return s;
}

function normalizeExamType(v, { required = false } = {}) {
    if (v === undefined || v === null || String(v).trim() === "") {
        if (required) throw new Error("Exam type is required");
        return null;
    }
    const s = String(v).trim();
    if (!VALID_EXAM_TYPES.includes(s)) {
        throw new Error(`Invalid exam type. Allowed: ${VALID_EXAM_TYPES.join(", ")}`);
    }
    return s;
}

function normalizeResultStatus(v, { required = false } = {}) {
    if (v === undefined || v === null || String(v).trim() === "") {
        if (required) throw new Error("Result status is required");
        return null;
    }
    const s = String(v).trim();
    if (!VALID_RESULT_STATUSES.includes(s)) {
        throw new Error(`Invalid result status. Allowed: ${VALID_RESULT_STATUSES.join(", ")}`);
    }
    return s;
}

function parsePagination(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(
        Math.max(parseInt(query.limit, 10) || DEFAULT_PAGE_LIMIT, 1),
        MAX_PAGE_LIMIT
    );
    return { page, limit, offset: (page - 1) * limit };
}

function parseMarksheetId(raw) {
    const id = parseInt(raw, 10);
    if (isNaN(id) || id <= 0) throw new Error("Invalid marksheet id");
    return id;
}

function getGrade(percentage) {
    const p = parseFloat(percentage) || 0;
    if (p >= 90) return "A+";
    if (p >= 80) return "A";
    if (p >= 70) return "B+";
    if (p >= 60) return "B";
    if (p >= 50) return "C";
    if (p >= 40) return "D";
    if (p >= 33) return "E";
    return "F";
}

function calculateOverallStatus(marksheets) {
    if (!marksheets || marksheets.length === 0) return null;

    const statuses = marksheets
        .map(m => m.result_status)
        .filter(s => s && s !== "");

    if (statuses.length === 0) return null;

    let worstStatus = statuses[0];
    let worstPriority = STATUS_PRIORITY[worstStatus] || 0;

    for (const status of statuses) {
        const p = STATUS_PRIORITY[status] || 0;
        if (p > worstPriority) {
            worstStatus = status;
            worstPriority = p;
        }
    }

    const breakdown = statuses.reduce((acc, s) => {
        acc[s] = (acc[s] || 0) + 1;
        return acc;
    }, {});

    return {
        status: worstStatus,
        priority: worstPriority,
        total_results: statuses.length,
        breakdown,
        reason: getStatusReason(worstStatus, breakdown)
    };
}

function getStatusReason(worstStatus, breakdown) {
    switch (worstStatus) {
        case "Withheld": return "Result withheld by school administration";
        case "Absent": return `Student was absent in ${breakdown["Absent"] || 1} examination(s)`;
        case "Fail": return `Failed in ${breakdown["Fail"] || 1} examination(s)`;
        case "Supply": return `Supply in ${breakdown["Supply"] || 1} examination(s)`;
        case "Compartment": return `Compartment in ${breakdown["Compartment"] || 1} examination(s)`;
        case "Pass": return "All examinations passed successfully";
        default: return "";
    }
}

function parseSubjects(raw) {
    if (!raw) return null;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed) || parsed.length === 0) return null;

        return parsed
            .map(s => ({
                name: String(s.name || "").trim().slice(0, 100),
                obtained: parseInt(s.obtained) || 0,
                max: parseInt(s.max) || 0
            }))
            .filter(s => s.name && s.max > 0);
    } catch (e) {
        throw new Error("Invalid subjects JSON format");
    }
}

function parseStoredSubjects(raw) {
    if (!raw) return [];
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// ============================================================
// CLOUDINARY STORAGE
// ============================================================

const storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => {
        const session = normalizeSession(req.body.session) || "2026-27";
        const sessionSafe = session.replace(/[^a-zA-Z0-9-]/g, "-");
        const classStr = (req.body.class || "default").replace(/[^a-zA-Z0-9-]/g, "-");
        const studentId = (req.body.student_id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");
        const examType = (req.body.exam_type || "exam").replace(/[^a-zA-Z0-9_-]/g, "-");

        return {
            folder: `gsssshilla/marksheets/${sessionSafe}/class-${classStr}`,
            resource_type: "raw",
            public_id: `${studentId}-${examType}-${Date.now()}`,
            format: "pdf"
        };
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_PDF_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") return cb(null, true);
        cb(new Error("Only PDF files are allowed"));
    }
});

function handleUpload(req, res, next) {
    upload.single("pdf")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return fail(res, `File too large. Maximum ${MAX_PDF_SIZE_BYTES / 1024 / 1024} MB allowed`, 400);
            }
            return fail(res, "Upload error: " + err.message, 400);
        }
        if (err) return fail(res, err.message || "Upload failed", 400);
        next();
    });
}

async function destroyCloudinaryFile(publicId, resourceType = "raw") {
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        log.info(`Cloudinary file deleted: ${publicId}`);
    } catch (err) {
        log.warn(`Cloudinary cleanup failed: ${publicId}`, { error: err.message });
    }
}

// ============================================================
// SECTION 0: PDF PROXY
// ============================================================

router.get("/proxy-pdf", asyncHandler(async (req, res) => {
    const { url } = req.query;
    if (!url) return fail(res, "URL is required", 400);
    if (!url.includes("res.cloudinary.com")) {
        return fail(res, "Only Cloudinary URLs are allowed", 400);
    }

    const client = url.startsWith("https") ? https : http;

    client.get(url, (remoteRes) => {
        if ([301, 302, 307, 308].includes(remoteRes.statusCode) && remoteRes.headers.location) {
            remoteRes.resume();
            return res.redirect(remoteRes.headers.location);
        }
        if (remoteRes.statusCode !== 200) {
            remoteRes.resume();
            return fail(res, `Cloudinary returned ${remoteRes.statusCode}`, remoteRes.statusCode);
        }

        const contentType = remoteRes.headers["content-type"] || "application/pdf";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        remoteRes.pipe(res);
    }).on("error", (err) => {
        log.error("PDF proxy error", { error: err.message });
        if (!res.headersSent) fail(res, err.message, 500);
    });
}));

// ============================================================
// SECTION 1: STUDENT + MARKSHEETS FETCH
// ============================================================

router.get("/students/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    if (!studentId || studentId.trim() === "") {
        return fail(res, "Student ID is required", 400);
    }

    const students = await q(`
        SELECT
            id, student_id, admission_number, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, session, roll_number,
            status, mobile_number, email_id, gender, category, address, stream,
            village, post_office, tehsil, district, state, pincode
        FROM Nstudent
        WHERE student_id = ?
        LIMIT 1
    `, [studentId]);

    if (students.length === 0) {
        return fail(res, `Student not found: ${studentId}`, 404);
    }

    const marksheetsRaw = await q(`
        SELECT
            id, session, exam_session, class, exam_type,
            obtained_marks, max_marks,
            result_status, subjects, remarks,
            cloudinary_url, cloudinary_public_id,
            is_published, uploaded_at, updated_at,
            original_filename, file_size, declaration_date
        FROM marksheets
        WHERE student_id = ?
        ORDER BY session DESC, exam_type ASC
    `, [studentId]);

    const marksheets = marksheetsRaw.map(m => ({
        ...m,
        subjects: parseStoredSubjects(m.subjects)
    }));

    const publishedOnly = marksheets.filter(m => m.is_published === 1);
    const overallStatus = calculateOverallStatus(publishedOnly);

    return ok(res, {
        student: students[0],
        marksheets,
        overall_status: overallStatus?.status || null,
        overall_status_reason: overallStatus?.reason || null,
        status_breakdown: overallStatus?.breakdown || {},
        total_published: publishedOnly.length
    }, "Student fetched successfully");
}));

// ============================================================
// SECTION 2: MARKSHEET MANAGEMENT
// ============================================================

router.post("/marksheets/upload", handleUpload, asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || "").trim();

    const cleanupFile = async () => {
        if (req.file?.filename) await destroyCloudinaryFile(req.file.filename, "raw");
    };

    if (!student_id) { await cleanupFile(); return fail(res, "Student ID is required", 400); }

    let session, classStr, exam_type, exam_session, result_status, subjects;
    try {
        session = normalizeSession(req.body.session);
        classStr = normalizeClass(req.body.class, { required: true });
        exam_type = normalizeExamType(req.body.exam_type, { required: true });
        exam_session = normalizeSession(req.body.exam_session);
        result_status = normalizeResultStatus(req.body.result_status);
        subjects = parseSubjects(req.body.subjects);
    } catch (err) {
        await cleanupFile();
        return fail(res, err.message, 400);
    }

    const obtained_marks = req.body.obtained_marks || null;
    const max_marks = req.body.max_marks || null;
    const remarks = req.body.remarks ? String(req.body.remarks).trim().slice(0, 500) : null;

    if (!session) { await cleanupFile(); return fail(res, "Session is required", 400); }
    if (!req.file) return fail(res, "PDF file is required", 400);

    const students = await q("SELECT id FROM Nstudent WHERE student_id = ? LIMIT 1", [student_id]);
    if (students.length === 0) {
        await cleanupFile();
        return fail(res, `Student not found: ${student_id}`, 404);
    }

    const existing = await q(
        `SELECT id FROM marksheets 
         WHERE student_id = ? AND session = ? AND class = ? AND exam_type = ? 
         LIMIT 1`,
        [student_id, session, classStr, exam_type]
    );
    if (existing.length > 0) {
        await cleanupFile();
        return fail(res, "Marksheet already exists for this exam & session", 409);
    }

    let finalObtained = obtained_marks;
    let finalMax = max_marks;
    if (subjects && subjects.length > 0) {
        if (!finalObtained) finalObtained = String(subjects.reduce((s, x) => s + x.obtained, 0));
        if (!finalMax) finalMax = String(subjects.reduce((s, x) => s + x.max, 0));
    }

    const insertResult = await q(`
        INSERT INTO marksheets (
            student_id, session, class, exam_type,
            exam_session, obtained_marks, max_marks,
            result_status, subjects, remarks,
            cloudinary_public_id, cloudinary_url, original_filename, file_size, is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        student_id, session, classStr, exam_type,
        exam_session || null, finalObtained, finalMax,
        result_status, subjects ? JSON.stringify(subjects) : null, remarks,
        req.file.filename, req.file.path, req.file.originalname, req.file.size, 0
    ]);

    log.success(`Marksheet uploaded`, { student_id, exam_type, status: result_status, id: insertResult.insertId });

    return ok(res, {
        marksheet_id: insertResult.insertId,
        cloudinary_url: req.file.path,
        status: "unpublished",
        result_status,
        subjects_count: subjects?.length || 0
    }, "Marksheet uploaded successfully (Unpublished)", 201);
}));

router.get("/marksheets", asyncHandler(async (req, res) => {
    const { student_id, session, class: cls, exam_type, is_published, result_status } = req.query;
    const { page, limit, offset } = parsePagination(req.query);

    const where = [];
    const params = [];

    if (student_id) { where.push("m.student_id LIKE ?"); params.push(`%${student_id}%`); }
    if (session) {
        const variants = getSessionVariants(session);
        where.push(`m.session IN (${variants.map(() => "?").join(",")})`);
        params.push(...variants);
    }
    if (cls) { where.push("m.class = ?"); params.push(normalizeClass(cls)); }
    if (exam_type) { where.push("m.exam_type = ?"); params.push(normalizeExamType(exam_type)); }
    if (is_published !== undefined && is_published !== "") {
        where.push("m.is_published = ?");
        params.push(is_published === "true" || is_published === "1" ? 1 : 0);
    }
    if (result_status) {
        where.push("m.result_status = ?");
        params.push(normalizeResultStatus(result_status));
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await q(`SELECT COUNT(*) AS total FROM marksheets m ${whereSql}`, params);
    const total = countResult[0]?.total || 0;

    const rows = await q(`
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.result_status, m.subjects, m.remarks,
            m.cloudinary_url, m.is_published, m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size, m.declaration_date,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob,
            s.roll_number AS exam_roll_no,
            s.class AS student_class,
            s.session AS student_session
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        ${whereSql}
        ORDER BY m.uploaded_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const marksheets = rows.map(m => ({
        ...m,
        subjects: parseStoredSubjects(m.subjects)
    }));

    return ok(res, marksheets, "Marksheets fetched successfully", 200, {
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

router.get("/marksheets/:id", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);

    const rows = await q(`
        SELECT
            m.*,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob,
            s.roll_number AS exam_roll_no,
            s.class AS student_class,
            s.session AS student_session
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        WHERE m.id = ?
        LIMIT 1
    `, [id]);

    if (rows.length === 0) return fail(res, `Marksheet not found: ${id}`, 404);

    const marksheet = {
        ...rows[0],
        subjects: parseStoredSubjects(rows[0].subjects)
    };

    return ok(res, marksheet, "Marksheet fetched successfully");
}));

router.put("/marksheets/:id/replace", handleUpload, asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);
    if (!req.file) return fail(res, "PDF file is required", 400);

    const rows = await q("SELECT cloudinary_public_id FROM marksheets WHERE id = ? LIMIT 1", [id]);
    if (rows.length === 0) {
        await destroyCloudinaryFile(req.file.filename, "raw");
        return fail(res, `Marksheet not found: ${id}`, 404);
    }

    const oldPid = rows[0].cloudinary_public_id;

    await q(`
        UPDATE marksheets
        SET cloudinary_public_id = ?, cloudinary_url = ?,
            original_filename = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [req.file.filename, req.file.path, req.file.originalname, req.file.size, id]);

    if (oldPid) await destroyCloudinaryFile(oldPid, "raw");

    log.success(`Marksheet replaced`, { id });
    return ok(res, { cloudinary_url: req.file.path }, "Marksheet replaced successfully");
}));

router.patch("/marksheets/:id/status", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);
    const { result_status, remarks } = req.body;

    if (!result_status) return fail(res, "result_status is required", 400);

    let status;
    try {
        status = normalizeResultStatus(result_status, { required: true });
    } catch (err) {
        return fail(res, err.message, 400);
    }

    const cleanRemarks = remarks ? String(remarks).trim().slice(0, 500) : null;

    const result = await q(
        `UPDATE marksheets 
         SET result_status = ?, remarks = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [status, cleanRemarks, id]
    );

    if (result.affectedRows === 0) return fail(res, `Marksheet not found: ${id}`, 404);

    log.success(`Marksheet status updated`, { id, status });
    return ok(res, { result_status: status, remarks: cleanRemarks }, "Status updated successfully");
}));

router.delete("/marksheets/:id", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);

    const rows = await q("SELECT cloudinary_public_id FROM marksheets WHERE id = ? LIMIT 1", [id]);
    if (rows.length === 0) return fail(res, `Marksheet not found: ${id}`, 404);

    await q("DELETE FROM marksheets WHERE id = ?", [id]);

    if (rows[0].cloudinary_public_id) {
        await destroyCloudinaryFile(rows[0].cloudinary_public_id, "raw");
    }

    log.success(`Marksheet deleted`, { id });
    return ok(res, null, "Marksheet deleted successfully");
}));

// ============================================================
// SECTION 3: PUBLISH / UNPUBLISH
// ============================================================

router.post("/marksheets/:id/publish", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);
    const { declaration_date } = req.body;

    if (!declaration_date) return fail(res, "Declaration date is required", 400);
    if (isNaN(Date.parse(declaration_date))) return fail(res, "Invalid declaration date", 400);

    const result = await q(
        `UPDATE marksheets 
         SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [declaration_date, id]
    );

    if (result.affectedRows === 0) return fail(res, `Marksheet not found: ${id}`, 404);

    log.success(`Marksheet published`, { id, declaration_date });
    return ok(res, { declaration_date }, "Marksheet published successfully");
}));

router.post("/marksheets/:id/unpublish", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);

    const result = await q(
        "UPDATE marksheets SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [id]
    );

    if (result.affectedRows === 0) return fail(res, `Marksheet not found: ${id}`, 404);

    log.success(`Marksheet unpublished`, { id });
    return ok(res, null, "Marksheet unpublished successfully");
}));

router.post("/marksheets/bulk-publish", asyncHandler(async (req, res) => {
    const { ids, declaration_date } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return fail(res, "ids array is required and must not be empty", 400);
    }
    if (!declaration_date) return fail(res, "Declaration date is required", 400);
    if (isNaN(Date.parse(declaration_date))) return fail(res, "Invalid declaration date", 400);

    const cleanIds = ids.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v) && v > 0);
    if (cleanIds.length === 0) return fail(res, "No valid marksheet ids provided", 400);

    const ph = cleanIds.map(() => "?").join(",");
    const result = await q(
        `UPDATE marksheets 
         SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id IN (${ph})`,
        [declaration_date, ...cleanIds]
    );

    log.success(`Bulk publish done`, { published: result.affectedRows, requested: cleanIds.length });

    return ok(res, {
        published: result.affectedRows,
        requested: cleanIds.length
    }, `${result.affectedRows} marksheet(s) published`);
}));

router.post("/marksheets/bulk-status", asyncHandler(async (req, res) => {
    const { ids, result_status, remarks } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) return fail(res, "ids array is required", 400);
    if (!result_status) return fail(res, "result_status is required", 400);

    let status;
    try {
        status = normalizeResultStatus(result_status, { required: true });
    } catch (err) {
        return fail(res, err.message, 400);
    }

    const cleanIds = ids.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v) && v > 0);
    if (cleanIds.length === 0) return fail(res, "No valid ids", 400);

    const cleanRemarks = remarks ? String(remarks).trim().slice(0, 500) : null;
    const ph = cleanIds.map(() => "?").join(",");

    const result = await q(
        `UPDATE marksheets 
         SET result_status = ?, remarks = COALESCE(?, remarks), updated_at = CURRENT_TIMESTAMP 
         WHERE id IN (${ph})`,
        [status, cleanRemarks, ...cleanIds]
    );

    log.success(`Bulk status update`, { status, count: result.affectedRows });
    return ok(res, { updated: result.affectedRows, status }, `${result.affectedRows} marksheet(s) status updated`);
}));

// ============================================================
// SECTION 4: CLASS-WISE STUDENTS
// ============================================================

router.get("/class/:classId/students", asyncHandler(async (req, res) => {
    const classStr = normalizeClass(req.params.classId, { required: true });
    const session = normalizeSession(req.query.session);
    const { page, limit, offset } = parsePagination(req.query);

    const baseParams = [classStr];
    let sessionClause = "";

    if (session) {
        const variants = getSessionVariants(session);
        sessionClause = ` AND s.session IN (${variants.map(() => "?").join(",")})`;
        baseParams.push(...variants);
    }

    const countResult = await q(
        `SELECT COUNT(*) AS total FROM Nstudent s WHERE s.class = ? ${sessionClause}`,
        baseParams
    );
    const total = countResult[0]?.total || 0;

    const students = await q(`
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.student_photo_url AS photo,
            s.class, s.session,
            s.roll_number AS exam_roll_no,
            s.status,
            (SELECT COUNT(*) FROM marksheets m WHERE m.student_id = s.student_id) AS marksheet_count,
            (SELECT COUNT(*) FROM marksheets m 
             WHERE m.student_id = s.student_id AND m.is_published = 1) AS published_count
        FROM Nstudent s
        WHERE s.class = ? ${sessionClause}
        ORDER BY s.name ASC
        LIMIT ? OFFSET ?
    `, [...baseParams, limit, offset]);

    return ok(res, students, "Class students fetched successfully", 200, {
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// ============================================================
// SECTION 5: PUBLIC APIs
// ============================================================

router.post("/public/search", asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || "").trim();
    const dob = req.body.dob;
    const classFilter = req.body.class;
    const sessionFilter = req.body.session;

    if (!student_id || !dob) {
        return fail(res, "Student ID and Date of Birth are required", 400);
    }

    let studentSql = `
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, session,
            roll_number AS exam_roll_no, status
        FROM Nstudent
        WHERE student_id = ? AND DATE(dob) = DATE(?)
    `;
    const studentParams = [student_id, dob];

    if (classFilter) {
        studentSql += " AND class = ?";
        studentParams.push(String(classFilter));
    }

    const students = await q(studentSql, studentParams);

    if (students.length === 0) {
        return fail(res, "No student found with the provided details", 404);
    }

    let mSql = `
        SELECT id, session, exam_session, class, exam_type,
               obtained_marks, max_marks,
               result_status, subjects, remarks,
               cloudinary_url, uploaded_at, declaration_date
        FROM marksheets
        WHERE student_id = ? AND is_published = 1
    `;
    const mParams = [student_id];

    if (sessionFilter) {
        const variants = getSessionVariants(sessionFilter);
        mSql += ` AND session IN (${variants.map(() => "?").join(",")})`;
        mParams.push(...variants);
    }

    mSql += " ORDER BY session DESC, exam_type ASC";

    const marksheetsRaw = await q(mSql, mParams);
    const marksheets = marksheetsRaw.map(m => ({
        ...m,
        subjects: parseStoredSubjects(m.subjects)
    }));

    const overallStatus = calculateOverallStatus(marksheets);

    log.info(`Public search success`, { student_id, marksheets: marksheets.length, overall_status: overallStatus?.status });

    return ok(res, {
        student: students[0],
        marksheets,
        overall_status: overallStatus?.status || null,
        overall_status_reason: overallStatus?.reason || null
    }, "Result fetched successfully");
}));

router.get("/public/classes", asyncHandler(async (req, res) => {
    const classes = await q(`
        SELECT
            class,
            COUNT(*) AS total_published,
            MAX(declaration_date) AS declared_date,
            MAX(session) AS session,
            (SELECT exam_type FROM marksheets m2
             WHERE m2.class = m.class AND m2.is_published = 1
             ORDER BY m2.declaration_date DESC, m2.uploaded_at DESC 
             LIMIT 1) AS latest_exam_type
        FROM marksheets m
        WHERE is_published = 1
        GROUP BY class
        ORDER BY FIELD(class, 'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')
    `);

    const formatted = classes.map((c) => ({
        class: c.class,
        session: c.session || "",
        total_published: c.total_published,
        exam_type: c.latest_exam_type || "Various",
        declared_date: c.declared_date
            ? new Date(c.declared_date).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric"
            })
            : null
    }));

    return ok(res, formatted, "Public classes fetched successfully");
}));

router.get("/public/marksheet/:id", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);

    const rows = await q(
        "SELECT cloudinary_url FROM marksheets WHERE id = ? AND is_published = 1 LIMIT 1",
        [id]
    );

    if (rows.length === 0) {
        return fail(res, "Marksheet not found or not published", 404);
    }

    return res.redirect(rows[0].cloudinary_url);
}));

router.get("/public/marksheet/:id/download", asyncHandler(async (req, res) => {
    const id = parseMarksheetId(req.params.id);

    const rows = await q(
        `SELECT cloudinary_public_id, original_filename 
         FROM marksheets 
         WHERE id = ? AND is_published = 1 
         LIMIT 1`,
        [id]
    );

    if (rows.length === 0) {
        return fail(res, "Marksheet not found or not published", 404);
    }

    const downloadUrl = cloudinary.url(rows[0].cloudinary_public_id, {
        resource_type: "raw",
        flags: "attachment",
        filename: rows[0].original_filename || "marksheet.pdf"
    });

    return res.redirect(downloadUrl);
}));

// ============================================================
// SECTION 6: STUDENT APIs
// ============================================================
// ============================================================
// SECTION 6: STUDENT APIs — COMPLETE DATA
// ============================================================

router.get("/student/my-results/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    if (!studentId || studentId.trim() === "") {
        return fail(res, "Student ID is required", 400);
    }

    // ✅ COMPLETE STUDENT FETCH — saari fields (print ke liye zaroori)
    const students = await q(`
        SELECT
            id, student_id, admission_number, apaar_id,
            name, father_name, mother_name,
            dob, gender, category,
            class, stream, session, roll_number,
            student_photo_url AS photo,
            signature_url,
            aadhar_number,
            mobile_number, email_id,
            status,
            address, village, post_office, tehsil, district, state, pincode
        FROM Nstudent
        WHERE student_id = ?
        LIMIT 1
    `, [studentId]);

    if (students.length === 0) {
        return fail(res, `Student not found: ${studentId}`, 404);
    }

    // ✅ COMPLETE MARKSHEETS with subjects parsed
    const marksheetsRaw = await q(`
        SELECT
            id, session, exam_session, class, exam_type,
            obtained_marks, max_marks,
            result_status, subjects, remarks,
            cloudinary_url, is_published, uploaded_at, declaration_date
        FROM marksheets
        WHERE student_id = ? AND is_published = 1
        ORDER BY session DESC, exam_type ASC
    `, [studentId]);

    const marksheets = marksheetsRaw.map(m => ({
        ...m,
        subjects: parseStoredSubjects(m.subjects)
    }));

    // ✅ Auto overall status
    const overallStatus = calculateOverallStatus(marksheets);

    // ✅ Summary calculation
    let totalObtained = 0, totalMax = 0;
    marksheets.forEach(m => {
        totalObtained += parseInt(m.obtained_marks) || 0;
        totalMax += parseInt(m.max_marks) || 0;
    });
    const percentage = totalMax > 0 ? ((totalObtained / totalMax) * 100).toFixed(2) : "0.00";
    const grade = getGrade(percentage);

    log.info(`Student my-results fetched`, {
        studentId,
        marksheets: marksheets.length,
        overall_status: overallStatus?.status
    });

    return ok(res, {
        student: students[0],
        marksheets,
        summary: {
            totalObtained,
            totalMax,
            percentage,
            grade,
            overall_status: overallStatus?.status || null,
            overall_status_reason: overallStatus?.reason || null,
            status_breakdown: overallStatus?.breakdown || {},
            total_published: marksheets.length
        }
    }, marksheets.length > 0 ? "Results fetched successfully" : "No published results yet");
}));









        

// ============================================================
// SECTION 7: DASHBOARD STATS
// ============================================================

router.get("/dashboard/stats", asyncHandler(async (req, res) => {
    const overall = await q(`
        SELECT
            COUNT(DISTINCT student_id) AS total_students,
            COUNT(*) AS total_marksheets,
            SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) AS published_results,
            SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END) AS unpublished_results,
            SUM(CASE WHEN result_status = 'Pass' THEN 1 ELSE 0 END) AS pass_count,
            SUM(CASE WHEN result_status = 'Fail' THEN 1 ELSE 0 END) AS fail_count,
            SUM(CASE WHEN result_status = 'Compartment' THEN 1 ELSE 0 END) AS compartment_count,
            SUM(CASE WHEN result_status = 'Supply' THEN 1 ELSE 0 END) AS supply_count
        FROM marksheets
    `);

    const classWise = await q(`
        SELECT
            class,
            COUNT(DISTINCT student_id) AS students,
            COUNT(*) AS marksheets,
            SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) AS published,
            SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END) AS unpublished,
            SUM(CASE WHEN result_status = 'Pass' THEN 1 ELSE 0 END) AS pass_count,
            SUM(CASE WHEN result_status = 'Fail' THEN 1 ELSE 0 END) AS fail_count
        FROM marksheets
        GROUP BY class
        ORDER BY FIELD(class, 'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')
    `);

    return ok(res, {
        overall: overall[0] || {
            total_students: 0, total_marksheets: 0,
            published_results: 0, unpublished_results: 0,
            pass_count: 0, fail_count: 0, compartment_count: 0, supply_count: 0
        },
        class_wise: classWise
    }, "Dashboard stats fetched successfully");
}));

// ============================================================
// GLOBAL ERROR HANDLER — MUST BE LAST
// ============================================================

router.use((err, req, res, next) => {
    log.error("Unhandled route error", {
        path: req.originalUrl,
        method: req.method,
        error: err.message
    });
    if (res.headersSent) return next(err);
    return fail(res, err.message || "Internal server error", 500);
});

module.exports = router;
