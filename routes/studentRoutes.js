// ============================================================
//  RESULT ROUTES — Alag File (Student Management se Independent)
//  ✅ Student details Nstudent table se fetch hoti hain
//  ✅ Marksheet PDFs marksheets table me store hoti hain
//  ✅ Student CRUD studentRoutes.js me hai — ye file sirf RESULT handle karti hai
// ============================================================

const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const https = require("https");
const http = require("http");

const db = require("../config/db");
const { cloudinary } = require("../config/cloudinary");

const q = (sql, params = []) => db.query(sql, params);
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// ==================== CONSTANTS ====================
const VALID_CLASSES = ["Nursery","LKG","UKG","1","2","3","4","5","6","7","8","9","10","11","12"];
const VALID_EXAM_TYPES = [
    "Annual Examination",
    "Half Yearly Examination",
    "Pre Board",
    "Board Examination",
    "Final Examination",
    "Monthly Test",
    "Unit Test"
];

// ==================== HELPERS ====================
function normalizeSession(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
}

function getSessionVariants(session) {
    if (!session) return [session];
    const variants = [session];
    const m = session.match(/^(\d{4})-(\d{2})$/);
    if (m) {
        const fullEndYear = 2000 + parseInt(m[2]);
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
    if (!VALID_CLASSES.includes(s)) throw new Error("Invalid class");
    return s;
}

function normalizeExamType(v, { required = false } = {}) {
    if (v === undefined || v === null || String(v).trim() === "") {
        if (required) throw new Error("Exam type is required");
        return null;
    }
    const s = String(v).trim();
    if (!VALID_EXAM_TYPES.includes(s)) throw new Error("Invalid exam type");
    return s;
}

// ============================================================
// CLOUDINARY STORAGE (PDF only)
// ============================================================
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
        const session = normalizeSession(req.body.session) || "2026-27";
        const sessionSafe = session.replace(/[^a-zA-Z0-9-]/g, "-");
        const classStr = normalizeClass(req.body.class) || "default";
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
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") cb(null, true);
        else cb(new Error("Only PDF files are allowed"), false);
    }
});

function handleUpload(req, res, next) {
    upload.single("pdf")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(400).json({ success: false, message: "File too large. Max 10MB." });
            }
            return res.status(400).json({ success: false, message: "Upload error: " + err.message });
        }
        if (err) return res.status(400).json({ success: false, message: err.message || "Upload failed" });
        next();
    });
}

// ============================================================
// PDF PROXY (Cloudinary raw PDF view fix)
// ============================================================
router.get("/proxy-pdf", asyncHandler(async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, message: "URL required" });
    if (!url.includes("res.cloudinary.com")) {
        return res.status(400).json({ success: false, message: "Only Cloudinary URLs allowed" });
    }

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
        let contentType = remoteRes.headers["content-type"] || "application/pdf";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.setHeader("Access-Control-Allow-Origin", "*");
        remoteRes.pipe(res);
    }).on("error", (err) => {
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    });
}));

// ============================================================
// SECTION 1: STUDENT FETCH (from Nstudent) + uski Marksheets
// ============================================================

// ✅ MAIN ROUTE: Student ID se student + uski saari marksheets
router.get("/students/:studentId", asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    // Nstudent table se student fetch
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
        return res.status(404).json({ success: false, message: "Student not found" });
    }

    // marksheets table se uski saari marksheets
    const marksheets = await q(`
        SELECT
            id, session, exam_session, class, exam_type,
            obtained_marks, max_marks,
            cloudinary_url, cloudinary_public_id,
            is_published, uploaded_at, updated_at,
            original_filename, file_size, declaration_date
        FROM marksheets
        WHERE student_id = ?
        ORDER BY session DESC, exam_type
    `, [studentId]);

    res.json({
        success: true,
        data: { student: students[0], marksheets }
    });
}));

// ============================================================
// SECTION 2: ADMIN — MARKSHEET MANAGEMENT
// ============================================================

// Upload new marksheet
router.post("/marksheets/upload", handleUpload, asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || "").trim();
    const session = normalizeSession(req.body.session);
    const classStr = normalizeClass(req.body.class, { required: true });
    const exam_type = normalizeExamType(req.body.exam_type, { required: true });
    const exam_session = normalizeSession(req.body.exam_session);
    const obtained_marks = req.body.obtained_marks || null;
    const max_marks = req.body.max_marks || null;

    const cleanupFile = async () => {
        if (req.file && req.file.filename) {
            try { await cloudinary.uploader.destroy(req.file.filename, { resource_type: "raw" }); } catch (e) {}
        }
    };

    if (!student_id) { await cleanupFile(); return res.status(400).json({ success: false, message: "Student ID is required" }); }
    if (!session) { await cleanupFile(); return res.status(400).json({ success: false, message: "Session is required" }); }
    if (!req.file) return res.status(400).json({ success: false, message: "PDF file is required" });

    // ✅ Nstudent se verify karo ki student exist karta hai
    const students = await q("SELECT id FROM Nstudent WHERE student_id = ?", [student_id]);
    if (students.length === 0) {
        await cleanupFile();
        return res.status(404).json({ success: false, message: "Student not found in Nstudent table" });
    }

    // Duplicate check
    const existing = await q(
        "SELECT id FROM marksheets WHERE student_id = ? AND session = ? AND class = ? AND exam_type = ?",
        [student_id, session, classStr, exam_type]
    );
    if (existing.length > 0) {
        await cleanupFile();
        return res.status(409).json({ success: false, message: "Marksheet already exists for this exam" });
    }

    const insertResult = await q(`
        INSERT INTO marksheets (
            student_id, session, class, exam_type,
            exam_session, obtained_marks, max_marks,
            cloudinary_public_id, cloudinary_url, original_filename, file_size, is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        student_id, session, classStr, exam_type,
        exam_session || null, obtained_marks, max_marks,
        req.file.filename, req.file.path, req.file.originalname, req.file.size, 0
    ]);

    res.status(201).json({
        success: true,
        message: "Marksheet uploaded successfully (Unpublished)",
        data: {
            marksheet_id: insertResult.insertId,
            cloudinary_url: req.file.path,
            status: "unpublished"
        }
    });
}));

// Get all marksheets (with Nstudent JOIN for student info)
router.get("/marksheets", asyncHandler(async (req, res) => {
    const { student_id, session, class: cls, exam_type, is_published } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

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

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await q(`SELECT COUNT(*) as total FROM marksheets m ${whereSql}`, params);
    const total = countResult[0]?.total || 0;

    // ✅ Nstudent se student info JOIN
    const marksheets = await q(`
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size, m.declaration_date,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob,
            s.roll_number AS exam_roll_no, s.class AS student_class, s.session AS student_session
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        ${whereSql}
        ORDER BY m.uploaded_at DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({
        success: true,
        data: marksheets,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// Get single marksheet
router.get("/marksheets/:id", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid marksheet id" });

    const marksheets = await q(`
        SELECT
            m.*,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob,
            s.roll_number AS exam_roll_no, s.class AS student_class, s.session AS student_session
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        WHERE m.id = ?
    `, [id]);

    if (marksheets.length === 0) return res.status(404).json({ success: false, message: "Marksheet not found" });
    res.json({ success: true, data: marksheets[0] });
}));

// Replace marksheet PDF
router.put("/marksheets/:id/replace", handleUpload, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid marksheet id" });
    if (!req.file) return res.status(400).json({ success: false, message: "PDF file is required" });

    const rows = await q("SELECT cloudinary_public_id FROM marksheets WHERE id = ?", [id]);
    if (rows.length === 0) {
        try { await cloudinary.uploader.destroy(req.file.filename, { resource_type: "raw" }); } catch (e) {}
        return res.status(404).json({ success: false, message: "Marksheet not found" });
    }

    const oldPid = rows[0].cloudinary_public_id;

    await q(`
        UPDATE marksheets
        SET cloudinary_public_id = ?, cloudinary_url = ?,
            original_filename = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [req.file.filename, req.file.path, req.file.originalname, req.file.size, id]);

    if (oldPid) {
        try { await cloudinary.uploader.destroy(oldPid, { resource_type: "raw" }); } catch (e) {}
    }

    res.json({
        success: true,
        message: "Marksheet replaced successfully",
        data: { cloudinary_url: req.file.path }
    });
}));

// Delete marksheet
router.delete("/marksheets/:id", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid marksheet id" });

    const rows = await q("SELECT cloudinary_public_id FROM marksheets WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Marksheet not found" });

    await q("DELETE FROM marksheets WHERE id = ?", [id]);

    if (rows[0].cloudinary_public_id) {
        try { await cloudinary.uploader.destroy(rows[0].cloudinary_public_id, { resource_type: "raw" }); } catch (e) {}
    }

    res.json({ success: true, message: "Marksheet deleted successfully" });
}));

// ============================================================
// SECTION 3: PUBLISH / UNPUBLISH
// ============================================================

router.post("/marksheets/:id/publish", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid marksheet id" });

    const { declaration_date } = req.body;
    if (!declaration_date) return res.status(400).json({ success: false, message: "Declaration date required" });
    if (isNaN(Date.parse(declaration_date))) return res.status(400).json({ success: false, message: "Invalid date" });

    const result = await q(
        `UPDATE marksheets SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [declaration_date, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Marksheet not found" });
    res.json({ success: true, message: "Marksheet published", data: { declaration_date } });
}));

router.post("/marksheets/:id/unpublish", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid marksheet id" });

    const result = await q("UPDATE marksheets SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Marksheet not found" });
    res.json({ success: true, message: "Marksheet unpublished" });
}));

router.post("/marksheets/bulk-publish", asyncHandler(async (req, res) => {
    const { ids, declaration_date } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "ids array required" });
    }
    if (!declaration_date) return res.status(400).json({ success: false, message: "Declaration date required" });

    const cleanIds = ids.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    if (cleanIds.length === 0) return res.status(400).json({ success: false, message: "No valid ids" });

    const ph = cleanIds.map(() => "?").join(",");
    const result = await q(
        `UPDATE marksheets SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ph})`,
        [declaration_date, ...cleanIds]
    );

    res.json({
        success: true,
        message: `${result.affectedRows} marksheet(s) published`,
        data: { published: result.affectedRows, requested: cleanIds.length }
    });
}));

// ============================================================
// SECTION 4: CLASS-WISE STUDENTS (from Nstudent) + Marksheet counts
// ============================================================

router.get("/class/:classId/students", asyncHandler(async (req, res) => {
    const classStr = normalizeClass(req.params.classId, { required: true });
    const session = normalizeSession(req.query.session);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const baseParams = [classStr];
    let sessionClause = "";
    if (session) {
        const variants = getSessionVariants(session);
        sessionClause = ` AND s.session IN (${variants.map(() => "?").join(",")})`;
        baseParams.push(...variants);
    }

    const countResult = await q(
        `SELECT COUNT(*) as total FROM Nstudent s WHERE s.class = ? ${sessionClause}`,
        baseParams
    );
    const total = countResult[0]?.total || 0;

    const students = await q(`
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.student_photo_url AS photo,
            s.class, s.session, s.roll_number AS exam_roll_no, s.status,
            (SELECT COUNT(*) FROM marksheets m WHERE m.student_id = s.student_id) AS marksheet_count,
            (SELECT COUNT(*) FROM marksheets m WHERE m.student_id = s.student_id AND m.is_published = 1) AS published_count
        FROM Nstudent s
        WHERE s.class = ? ${sessionClause}
        ORDER BY s.name ASC
        LIMIT ? OFFSET ?
    `, [...baseParams, limit, offset]);

    res.json({
        success: true,
        data: students,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// ============================================================
// SECTION 5: PUBLIC APIs (students ke liye — bina login)
// ============================================================

// Public search: Student ID + DOB verify
router.post("/public/search", asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || "").trim();
    const dob = req.body.dob;

    if (!student_id || !dob) {
        return res.status(400).json({ success: false, message: "Student ID and DOB required" });
    }

    const students = await q(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, session,
            roll_number AS exam_roll_no, status
        FROM Nstudent
        WHERE student_id = ? AND DATE(dob) = DATE(?)
    `, [student_id, dob]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: "No student found with provided details" });
    }

    const marksheets = await q(`
        SELECT id, session, exam_session, class, exam_type,
               obtained_marks, max_marks, cloudinary_url,
               uploaded_at, declaration_date
        FROM marksheets
        WHERE student_id = ? AND is_published = 1
        ORDER BY session DESC, exam_type
    `, [student_id]);

    res.json({ success: true, data: { student: students[0], marksheets } });
}));

// Public: List classes with published results
router.get("/public/classes", asyncHandler(async (req, res) => {
    const classes = await q(`
        SELECT
            class,
            COUNT(*) as total_published,
            MAX(declaration_date) as declared_date
        FROM marksheets
        WHERE is_published = 1
        GROUP BY class
        ORDER BY FIELD(class,'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')
    `);
    res.json({ success: true, data: classes });
}));

// Public: View marksheet PDF
router.get("/public/marksheet/:id", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const rows = await q(
        "SELECT cloudinary_url FROM marksheets WHERE id = ? AND is_published = 1",
        [id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Not found or unpublished" });

    return res.redirect(rows[0].cloudinary_url);
}));

// Public: Download marksheet PDF
router.get("/public/marksheet/:id/download", asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const rows = await q(
        "SELECT cloudinary_public_id, original_filename FROM marksheets WHERE id = ? AND is_published = 1",
        [id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Not found" });

    const downloadUrl = cloudinary.url(rows[0].cloudinary_public_id, {
        resource_type: "raw",
        flags: "attachment",
        filename: rows[0].original_filename || "marksheet.pdf"
    });
    return res.redirect(downloadUrl);
}));

// ============================================================
// SECTION 6: DASHBOARD STATS
// ============================================================

router.get("/dashboard/stats", asyncHandler(async (req, res) => {
    const overall = await q(`
        SELECT
            COUNT(DISTINCT student_id) as total_students,
            COUNT(*) as total_marksheets,
            SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) as published_results,
            SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END) as unpublished_results
        FROM marksheets
    `);

    const classWise = await q(`
        SELECT
            class,
            COUNT(DISTINCT student_id) as students,
            COUNT(*) as marksheets,
            SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) as published,
            SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END) as unpublished
        FROM marksheets
        GROUP BY class
        ORDER BY FIELD(class,'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')
    `);

    res.json({
        success: true,
        data: {
            overall: overall[0] || {
                total_students: 0,
                total_marksheets: 0,
                published_results: 0,
                unpublished_results: 0
            },
            class_wise: classWise
        }
    });
}));

module.exports = router;
