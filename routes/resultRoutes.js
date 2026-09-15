// ================================================================
//  COMPLETE RESULT MANAGEMENT ROUTES — Linked with Nstudent
//  Student data comes from Nstudent table (Student Management)
//  Marksheets stored separately with nstudent_id FK
// ================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const { query } = require('../config/db');
const cloudinary = require('../config/cloudinary').cloudinary;

const VALID_EXAM_TYPES = [
    'Annual Examination',
    'Half Yearly Examination',
    'Pre Board',
    'Board Examination',
    'Final Examination',
    'Monthly Test',
    'Unit Test'
];

// ================================================================
//  HELPERS
// ================================================================
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function normalizeSession(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
}

function normalizeClass(value, { required = false } = {}) {
    if (value === undefined || value === null || String(value).trim() === '') {
        if (required) throw new Error('Class is required');
        return null;
    }
    return String(value).trim();
}

function normalizeExamType(value, { required = false } = {}) {
    if (value === undefined || value === null || String(value).trim() === '') {
        if (required) throw new Error('Exam type is required');
        return null;
    }
    const trimmed = String(value).trim();
    if (!VALID_EXAM_TYPES.includes(trimmed)) {
        throw new Error('Invalid exam type');
    }
    return trimmed;
}

// ================================================================
//  CLOUDINARY STORAGE (Marksheet PDFs)
// ================================================================
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
        const session = normalizeSession(req.body.session) || 'unknown-session';
        const sessionSafe = session.replace(/[^a-zA-Z0-9-]/g, '-');
        const classNum = normalizeClass(req.body.class) || 'default';
        const studentId = (req.body.student_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
        const examType = (req.body.exam_type || 'exam').replace(/[^a-zA-Z0-9_-]/g, '-');

        return {
            folder: `gsssshilla/marksheets/${sessionSafe}/class-${classNum}`,
            resource_type: 'raw',
            public_id: `${studentId}-${examType}-${Date.now()}`,
            format: 'pdf'
        };
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

function handleUpload(req, res, next) {
    upload.single('pdf')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    success: false,
                    message: 'File too large. Maximum size is 10MB.'
                });
            }
            return res.status(400).json({ success: false, message: 'Upload error: ' + err.message });
        }
        if (err) {
            return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        }
        if (req.file) {
            console.log(`📄 File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);
        }
        next();
    });
}

// ================================================================
//  SECTION 1: STUDENT MANAGEMENT (from Nstudent)
// ================================================================

// ✅ GET All Students — from Nstudent table
router.get('/students', asyncHandler(async (req, res) => {
    const classVal = normalizeClass(req.query.class);
    const session = normalizeSession(req.query.session);
    const { student_id, name, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    let sql = `
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, section, session,
            roll_number AS exam_roll_no, email_id, mobile_number
        FROM Nstudent
        WHERE 1=1
    `;
    const params = [];

    if (classVal !== null) { sql += ' AND class = ?'; params.push(classVal); }
    if (session !== null) { sql += ' AND session = ?'; params.push(session); }
    if (student_id) { sql += ' AND student_id LIKE ?'; params.push(`%${student_id}%`); }
    if (name) { sql += ' AND name LIKE ?'; params.push(`%${name}%`); }
    if (search) {
        sql += ' AND (name LIKE ? OR student_id LIKE ? OR apaar_id LIKE ? OR father_name LIKE ?)';
        const like = `%${search}%`;
        params.push(like, like, like, like);
    }

    // Count query
    let countSql = 'SELECT COUNT(*) as total FROM Nstudent WHERE 1=1';
    const countParams = [];
    if (classVal !== null) { countSql += ' AND class = ?'; countParams.push(classVal); }
    if (session !== null) { countSql += ' AND session = ?'; countParams.push(session); }
    if (student_id) { countSql += ' AND student_id LIKE ?'; countParams.push(`%${student_id}%`); }
    if (name) { countSql += ' AND name LIKE ?'; countParams.push(`%${name}%`); }
    if (search) {
        countSql += ' AND (name LIKE ? OR student_id LIKE ? OR apaar_id LIKE ? OR father_name LIKE ?)';
        const like = `%${search}%`;
        countParams.push(like, like, like, like);
    }

    const countResult = await query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    sql += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const students = await query(sql, params);

    res.json({
        success: true,
        data: students,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// ✅ GET Single Student with marksheets
router.get('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, section, session,
            roll_number AS exam_roll_no, email_id, mobile_number
        FROM Nstudent
        WHERE student_id = ?
        LIMIT 1
    `, [studentId]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = students[0];

    const marksheets = await query(`
        SELECT
            id, session, exam_session, class, exam_type,
            obtained_marks, max_marks,
            cloudinary_url, is_published, declaration_date,
            uploaded_at, updated_at,
            original_filename, file_size
        FROM marksheets
        WHERE nstudent_id = ?
        ORDER BY uploaded_at DESC
    `, [student.id]);

    res.json({
        success: true,
        data: { student, marksheets }
    });
}));

// ✅ SEARCH Student (by ID or APAAR)
router.get('/students/search/:query', asyncHandler(async (req, res) => {
    const { query: searchQuery } = req.params;

    const students = await query(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, section, session,
            roll_number AS exam_roll_no, email_id, mobile_number
        FROM Nstudent
        WHERE student_id = ? OR apaar_id = ?
        LIMIT 1
    `, [searchQuery, searchQuery]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const student = students[0];

    const marksheets = await query(`
        SELECT
            id, session, exam_session, class, exam_type,
            obtained_marks, max_marks,
            cloudinary_url, is_published, declaration_date, uploaded_at
        FROM marksheets
        WHERE nstudent_id = ?
        ORDER BY uploaded_at DESC
    `, [student.id]);

    res.json({
        success: true,
        data: { student, marksheets }
    });
}));

// ================================================================
//  SECTION 2: CLASS-WISE MANAGEMENT
// ================================================================

router.get('/class/:classId/students', asyncHandler(async (req, res) => {
    const classId = normalizeClass(req.params.classId, { required: true });
    const session = normalizeSession(req.query.session);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const baseParams = [classId];
    let sessionClause = '';
    if (session !== null) {
        sessionClause = ' AND session = ?';
        baseParams.push(session);
    }

    const countResult = await query(
        `SELECT COUNT(*) as total FROM Nstudent WHERE class = ? ${sessionClause}`,
        baseParams
    );
    const total = countResult[0]?.total || 0;

    const sql = `
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.student_photo_url AS photo,
            s.class, s.section, s.session, s.roll_number AS exam_roll_no,
            COUNT(DISTINCT m.id) as marksheet_count,
            COALESCE(SUM(CASE WHEN m.is_published = 1 THEN 1 ELSE 0 END), 0) as published_count
        FROM Nstudent s
        LEFT JOIN marksheets m ON s.id = m.nstudent_id
        WHERE s.class = ? ${sessionClause.replace('session = ?', 's.session = ?')}
        GROUP BY s.id, s.student_id, s.apaar_id, s.name, s.father_name,
                 s.mother_name, s.dob, s.student_photo_url, s.class,
                 s.section, s.session, s.roll_number
        ORDER BY s.name ASC
        LIMIT ? OFFSET ?
    `;
    const params = [...baseParams, limit, offset];
    const students = await query(sql, params);

    res.json({
        success: true,
        data: students,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// ================================================================
//  SECTION 3: MARKSHEET MANAGEMENT
// ================================================================

// ✅ Upload marksheet
router.post('/marksheets/upload', handleUpload, asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || '').trim();
    const session = normalizeSession(req.body.session);
    const classNum = normalizeClass(req.body.class, { required: true });
    const exam_type = normalizeExamType(req.body.exam_type, { required: true });
    const exam_session = normalizeSession(req.body.exam_session);
    const obtained_marks = req.body.obtained_marks || null;
    const max_marks = req.body.max_marks || null;

    const cleanupFile = async () => {
        if (req.file && req.file.filename) {
            try { await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'raw' }); } catch (e) {}
        }
    };

    if (!student_id) { await cleanupFile(); return res.status(400).json({ success: false, message: 'Student ID is required' }); }
    if (!session) { await cleanupFile(); return res.status(400).json({ success: false, message: 'Session is required' }); }
    if (!req.file) { return res.status(400).json({ success: false, message: 'PDF file is required' }); }

    console.log(`📝 Upload: Student=${student_id}, Session=${session}, Class=${classNum}, Exam=${exam_type}`);

    // ✅ Student lookup from Nstudent
    const students = await query('SELECT id FROM Nstudent WHERE student_id = ?', [student_id]);
    if (students.length === 0) {
        await cleanupFile();
        return res.status(404).json({ success: false, message: 'Student not found in Nstudent table' });
    }
    const nstudentId = students[0].id;

    // Check existing
    const existing = await query(
        'SELECT id FROM marksheets WHERE nstudent_id = ? AND session = ? AND class = ? AND exam_type = ?',
        [nstudentId, session, classNum, exam_type]
    );
    if (existing.length > 0) {
        await cleanupFile();
        return res.status(409).json({
            success: false,
            message: 'Marksheet already exists for this combination'
        });
    }

    const cloudinaryData = {
        public_id: req.file.filename,
        secure_url: req.file.path,
        original_filename: req.file.originalname,
        file_size: req.file.size
    };

    const insertResult = await query(`
        INSERT INTO marksheets (
            nstudent_id, session, class, exam_type,
            exam_session, obtained_marks, max_marks,
            cloudinary_public_id, cloudinary_url, original_filename, file_size,
            is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
        nstudentId, session, classNum, exam_type,
        exam_session || null, obtained_marks, max_marks,
        cloudinaryData.public_id, cloudinaryData.secure_url,
        cloudinaryData.original_filename, cloudinaryData.file_size
    ]);

    res.status(201).json({
        success: true,
        message: 'Marksheet uploaded successfully (Unpublished)',
        data: {
            cloudinary_url: cloudinaryData.secure_url,
            status: 'unpublished',
            marksheet_id: insertResult.insertId
        }
    });
}));

// ✅ Get marksheets list
router.get('/marksheets', asyncHandler(async (req, res) => {
    const student_id = req.query.student_id;
    const session = normalizeSession(req.query.session);
    const classNum = normalizeClass(req.query.class);
    const exam_type = normalizeExamType(req.query.exam_type);
    const is_published = req.query.is_published;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    let sql = `
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.declaration_date,
            m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size,
            s.student_id, s.name, s.father_name, s.roll_number AS exam_roll_no
        FROM marksheets m
        JOIN Nstudent s ON m.nstudent_id = s.id
        WHERE 1=1
    `;
    const params = [];

    if (student_id) { sql += ' AND s.student_id LIKE ?'; params.push(`%${student_id}%`); }
    if (session !== null) { sql += ' AND m.session = ?'; params.push(session); }
    if (classNum !== null) { sql += ' AND m.class = ?'; params.push(classNum); }
    if (exam_type !== null) { sql += ' AND m.exam_type = ?'; params.push(exam_type); }
    if (is_published !== undefined && is_published !== '') {
        sql += ' AND m.is_published = ?';
        params.push(is_published === 'true' || is_published === '1' ? 1 : 0);
    }

    // Count
    let countSql = `SELECT COUNT(*) as total FROM marksheets m JOIN Nstudent s ON m.nstudent_id = s.id WHERE 1=1`;
    const countParams = [];
    if (student_id) { countSql += ' AND s.student_id LIKE ?'; countParams.push(`%${student_id}%`); }
    if (session !== null) { countSql += ' AND m.session = ?'; countParams.push(session); }
    if (classNum !== null) { countSql += ' AND m.class = ?'; countParams.push(classNum); }
    if (exam_type !== null) { countSql += ' AND m.exam_type = ?'; countParams.push(exam_type); }
    if (is_published !== undefined && is_published !== '') {
        countSql += ' AND m.is_published = ?';
        countParams.push(is_published === 'true' || is_published === '1' ? 1 : 0);
    }

    const countResult = await query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    sql += ' ORDER BY m.uploaded_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const marksheets = await query(sql, params);

    res.json({
        success: true,
        data: marksheets,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// ✅ Get single marksheet
router.get('/marksheets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.declaration_date,
            m.uploaded_at, m.original_filename, m.file_size,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob,
            s.roll_number AS exam_roll_no, s.student_photo_url AS photo
        FROM marksheets m
        JOIN Nstudent s ON m.nstudent_id = s.id
        WHERE m.id = ?
    `, [id]);

    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }
    res.json({ success: true, data: marksheets[0] });
}));

// ✅ Replace marksheet file
router.put('/marksheets/:id/replace', handleUpload, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    const marksheets = await query('SELECT cloudinary_public_id FROM marksheets WHERE id = ?', [id]);
    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }

    const oldPublicId = marksheets[0].cloudinary_public_id;

    const cloudinaryData = {
        public_id: req.file.filename,
        secure_url: req.file.path,
        original_filename: req.file.originalname,
        file_size: req.file.size
    };

    await query(`
        UPDATE marksheets
        SET cloudinary_public_id = ?, cloudinary_url = ?,
            original_filename = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [cloudinaryData.public_id, cloudinaryData.secure_url, cloudinaryData.original_filename, cloudinaryData.file_size, id]);

    if (oldPublicId) {
        try {
            await cloudinary.uploader.destroy(oldPublicId, { resource_type: 'raw' });
        } catch (err) {
            console.error('Cloudinary cleanup error:', err.message);
        }
    }

    res.json({ success: true, message: 'Marksheet replaced successfully', data: { cloudinary_url: cloudinaryData.secure_url } });
}));

// ✅ Delete marksheet
router.delete('/marksheets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const marksheets = await query('SELECT cloudinary_public_id FROM marksheets WHERE id = ?', [id]);
    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }

    await query('DELETE FROM marksheets WHERE id = ?', [id]);

    if (marksheets[0].cloudinary_public_id) {
        try {
            await cloudinary.uploader.destroy(marksheets[0].cloudinary_public_id, { resource_type: 'raw' });
        } catch (err) {
            console.error('Cloudinary cleanup error:', err.message);
        }
    }

    res.json({ success: true, message: 'Marksheet deleted successfully' });
}));

// ================================================================
//  SECTION 4: PUBLISH / UNPUBLISH
// ================================================================

router.post('/marksheets/:id/publish', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const { declaration_date } = req.body;
    if (!declaration_date) {
        return res.status(400).json({ success: false, message: 'Declaration date is required' });
    }
    if (isNaN(Date.parse(declaration_date))) {
        return res.status(400).json({ success: false, message: 'Invalid declaration date' });
    }

    const result = await query(
        `UPDATE marksheets
         SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [declaration_date, id]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }

    res.json({ success: true, message: 'Marksheet published successfully', data: { declaration_date } });
}));

router.post('/marksheets/:id/unpublish', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const result = await query(
        'UPDATE marksheets SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }

    res.json({ success: true, message: 'Marksheet unpublished successfully' });
}));

router.post('/marksheets/bulk-publish', asyncHandler(async (req, res) => {
    const { ids, declaration_date } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    if (!declaration_date) {
        return res.status(400).json({ success: false, message: 'Declaration date is required' });
    }

    const cleanIds = ids.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    if (cleanIds.length === 0) {
        return res.status(400).json({ success: false, message: 'No valid marksheet ids provided' });
    }

    const placeholders = cleanIds.map(() => '?').join(',');
    const result = await query(
        `UPDATE marksheets SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id IN (${placeholders})`,
        [declaration_date, ...cleanIds]
    );

    res.json({
        success: true,
        message: `${result.affectedRows} marksheet(s) published`,
        data: { published: result.affectedRows, requested: cleanIds.length }
    });
}));

// ================================================================
//  SECTION 5: PUBLIC RESULT APIS
// ================================================================

router.get('/public/classes', asyncHandler(async (req, res) => {
    const classes = await query(`
        SELECT
            class,
            COUNT(*) as total_published,
            MAX(declaration_date) as declared_date,
            (SELECT exam_type FROM marksheets m2
             WHERE m2.class = m.class AND m2.is_published = 1
             ORDER BY m2.declaration_date DESC LIMIT 1) as latest_exam_type
        FROM marksheets m
        WHERE is_published = 1
        GROUP BY class
        HAVING COUNT(*) > 0
        ORDER BY CAST(class AS UNSIGNED), class
    `);

    const formattedData = classes.map((c) => ({
        class: c.class,
        total_published: c.total_published,
        exam_type: c.latest_exam_type || 'Various',
        declared_date: c.declared_date
            ? new Date(c.declared_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
            : null
    }));

    res.json({ success: true, data: formattedData });
}));

router.get('/public/:session/:class', asyncHandler(async (req, res) => {
    const session = normalizeSession(req.params.session);
    const classNum = normalizeClass(req.params.class, { required: true });
    if (!session) {
        return res.status(400).json({ success: false, message: 'Session is required' });
    }

    const results = await query(`
        SELECT
            m.id, m.exam_type, m.obtained_marks, m.max_marks, m.cloudinary_url,
            s.student_id, s.name, s.father_name, s.mother_name,
            s.roll_number AS exam_roll_no
        FROM marksheets m
        JOIN Nstudent s ON m.nstudent_id = s.id
        WHERE m.session = ? AND m.class = ? AND m.is_published = 1
        ORDER BY s.name
    `, [session, classNum]);

    res.json({ success: true, data: results });
}));

router.post('/public/search', asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || '').trim();
    const dob = req.body.dob;

    if (!student_id || !dob) {
        return res.status(400).json({ success: false, message: 'Student ID and Date of Birth are required' });
    }

    const students = await query(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, section, session,
            roll_number AS exam_roll_no
        FROM Nstudent
        WHERE student_id = ? AND DATE(dob) = DATE(?)
    `, [student_id, dob]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'No student found with the provided Student ID and DOB' });
    }

    const student = students[0];

    const marksheets = await query(`
        SELECT id, session, exam_session, class, exam_type,
               obtained_marks, max_marks, cloudinary_url,
               declaration_date, uploaded_at
        FROM marksheets
        WHERE nstudent_id = ? AND is_published = 1
        ORDER BY session DESC, uploaded_at DESC
    `, [student.id]);

    res.json({ success: true, data: { student, marksheets } });
}));

// Public marksheet view — redirect to Cloudinary
router.get('/public/marksheet/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet ID' });
    }

    const marksheets = await query(
        `SELECT cloudinary_url FROM marksheets WHERE id = ? AND is_published = 1`,
        [id]
    );

    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found or not published' });
    }

    return res.redirect(marksheets[0].cloudinary_url);
}));

// Public marksheet download
router.get('/public/marksheet/:id/download', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet ID' });
    }

    const marksheets = await query(
        `SELECT cloudinary_public_id, original_filename FROM marksheets WHERE id = ? AND is_published = 1`,
        [id]
    );

    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found or not published' });
    }

    const downloadUrl = cloudinary.url(marksheets[0].cloudinary_public_id, {
        resource_type: 'raw',
        flags: 'attachment',
        filename: marksheets[0].original_filename || 'marksheet.pdf'
    });

    return res.redirect(downloadUrl);
}));

// ================================================================
//  SECTION 6: ADMIN DASHBOARD STATS
// ================================================================

router.get('/dashboard/stats', asyncHandler(async (req, res) => {
    const overallStats = await query(`
        SELECT
            (SELECT COUNT(*) FROM Nstudent) as total_students,
            COUNT(*) as total_marksheets,
            COALESCE(SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END), 0) as published_results,
            COALESCE(SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END), 0) as unpublished_results
        FROM marksheets
    `);

    const classStats = await query(`
        SELECT
            class,
            COUNT(DISTINCT nstudent_id) as students,
            COUNT(*) as marksheets,
            COALESCE(SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END), 0) as published,
            COALESCE(SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END), 0) as unpublished
        FROM marksheets
        GROUP BY class
        ORDER BY CAST(class AS UNSIGNED), class
    `);

    res.json({
        success: true,
        data: {
            overall: overallStats[0] || {
                total_students: 0, total_marksheets: 0, published_results: 0, unpublished_results: 0
            },
            class_wise: classStats || []
        }
    });
}));

module.exports = router;
