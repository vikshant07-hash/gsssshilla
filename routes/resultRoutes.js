// ================================================================
//  RESULT MANAGEMENT ROUTES — UPDATED VERSION
//  (No getConnection - uses simple query function)
// ================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const { query } = require('../config/db');
const cloudinary = require('../config/cloudinary').cloudinary;

const VALID_CLASSES = [6, 7, 8, 9, 10, 11, 12];
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
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || !VALID_CLASSES.includes(num)) {
        throw new Error('Invalid class. Must be 6-12');
    }
    return num;
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

function sendError(res, error, fallbackMessage) {
    console.error('❌', fallbackMessage, error);
    return res.status(500).json({ success: false, message: fallbackMessage });
}

// ================================================================
//  CLOUDINARY STORAGE
// ================================================================

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
        const session = normalizeSession(req.body.session) || '2025-26';
        const classNum = normalizeClass(req.body.class) || 'default';
        const studentId = (req.body.student_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
        const examType = (req.body.exam_type || 'exam').replace(/[^a-zA-Z0-9_-]/g, '-');
        return {
            folder: `school-results/marksheets/${session}/class-${classNum}`,
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
            return res.status(400).json({ success: false, message: 'Upload error: ' + err.message });
        }
        if (err) {
            return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        }
        next();
    });
}

// ================================================================
//  SECTION 1: STUDENT MANAGEMENT
// ================================================================

router.get('/students', asyncHandler(async (req, res) => {
    const classNum = normalizeClass(req.query.class);
    const session = normalizeSession(req.query.session);
    const { student_id, name } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    let sql = `
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no
        FROM students s
        LEFT JOIN academic_records ar ON s.id = ar.student_id
        WHERE 1=1
    `;
    const params = [];

    if (classNum !== null) { sql += ' AND ar.class = ?'; params.push(classNum); }
    if (session !== null) { sql += ' AND ar.session = ?'; params.push(session); }
    if (student_id) { sql += ' AND s.student_id LIKE ?'; params.push(`%${student_id}%`); }
    if (name) { sql += ' AND s.name LIKE ?'; params.push(`%${name}%`); }

    // Count total
    const countSql = sql.replace(
        `SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no`,
        'SELECT COUNT(DISTINCT s.id) as total'
    );
    const countResult = await query(countSql, params);
    const total = countResult[0]?.total || 0;

    sql += ' GROUP BY s.id, ar.session, ar.class, ar.section, ar.exam_roll_no';
    sql += ' ORDER BY s.name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const students = await query(sql, params);

    res.json({
        success: true,
        data: students,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

router.get('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query(`
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no
        FROM students s
        LEFT JOIN academic_records ar ON s.id = ar.student_id
        WHERE s.student_id = ?
        ORDER BY ar.session DESC
        LIMIT 1
    `, [studentId]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.class, m.exam_type,
            m.cloudinary_url, m.is_published, m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size
        FROM marksheets m
        WHERE m.student_id = ?
        ORDER BY m.session DESC, m.exam_type
    `, [students[0].id]);

    res.json({
        success: true,
        data: { student: students[0], marksheets }
    });
}));

router.post('/students', asyncHandler(async (req, res) => {
    const {
        student_id, apaar_id, name, father_name, mother_name,
        dob, photo, section, exam_roll_no
    } = req.body;

    const session = normalizeSession(req.body.session);
    const classNum = normalizeClass(req.body.class, { required: true });

    if (!student_id || !String(student_id).trim()) {
        return res.status(400).json({ success: false, message: 'Student ID is required' });
    }
    if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!session) {
        return res.status(400).json({ success: false, message: 'Session is required' });
    }

    // Check existing
    const existing = await query('SELECT id FROM students WHERE student_id = ?', [student_id]);
    if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'Student ID already exists' });
    }

    // Insert student
    const studentResult = await query(`
        INSERT INTO students (student_id, apaar_id, name, father_name, mother_name, dob, photo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [student_id, apaar_id || null, name, father_name || null, mother_name || null, dob || null, photo || null]);

    const studentDbId = studentResult.insertId;

    // Insert academic record
    await query(`
        INSERT INTO academic_records (student_id, session, class, section, exam_roll_no)
        VALUES (?, ?, ?, ?, ?)
    `, [studentDbId, session, classNum, section || null, exam_roll_no || null]);

    res.status(201).json({
        success: true,
        message: 'Student created successfully',
        data: { student_id, id: studentDbId }
    });
}));

router.put('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const { apaar_id, name, father_name, mother_name, dob, photo, section, exam_roll_no } = req.body;
    const session = normalizeSession(req.body.session);
    const classNum = normalizeClass(req.body.class);

    const students = await query('SELECT id FROM students WHERE student_id = ?', [studentId]);
    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const studentDbId = students[0].id;

    // Update student
    await query(`
        UPDATE students
        SET apaar_id = ?, name = ?, father_name = ?, mother_name = ?, dob = ?, photo = ?
        WHERE student_id = ?
    `, [apaar_id || null, name, father_name || null, mother_name || null, dob || null, photo || null, studentId]);

    // Update academic record if session and class provided
    if (session !== null && classNum !== null) {
        const existingAr = await query(
            'SELECT id FROM academic_records WHERE student_id = ? AND session = ? AND class = ?',
            [studentDbId, session, classNum]
        );
        if (existingAr.length > 0) {
            await query(
                'UPDATE academic_records SET section = ?, exam_roll_no = ? WHERE id = ?',
                [section || null, exam_roll_no || null, existingAr[0].id]
            );
        } else {
            await query(
                'INSERT INTO academic_records (student_id, session, class, section, exam_roll_no) VALUES (?, ?, ?, ?, ?)',
                [studentDbId, session, classNum, section || null, exam_roll_no || null]
            );
        }
    }

    res.json({ success: true, message: 'Student updated successfully' });
}));

router.delete('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query('SELECT id FROM students WHERE student_id = ?', [studentId]);
    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const marksheets = await query(
        'SELECT cloudinary_public_id FROM marksheets WHERE student_id = ?',
        [students[0].id]
    );

    // Delete student (cascade will delete marksheets)
    await query('DELETE FROM students WHERE student_id = ?', [studentId]);

    // Delete Cloudinary files
    for (const m of marksheets) {
        if (m.cloudinary_public_id) {
            try {
                await cloudinary.uploader.destroy(m.cloudinary_public_id, { resource_type: 'raw' });
            } catch (err) {
                console.error('Cloudinary delete error (non-fatal):', err.message);
            }
        }
    }

    res.json({ success: true, message: 'Student deleted successfully' });
}));

router.get('/students/search/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query(`
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no
        FROM students s
        LEFT JOIN academic_records ar ON s.id = ar.student_id
        WHERE s.student_id = ?
    `, [studentId]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.class, m.exam_type,
            m.cloudinary_url, m.is_published, m.uploaded_at
        FROM marksheets m
        WHERE m.student_id = ?
        ORDER BY m.session DESC, m.exam_type
    `, [students[0].id]);

    res.json({
        success: true,
        data: { student: students[0], marksheets }
    });
}));

// ================================================================
//  SECTION 2: CLASS-WISE MANAGEMENT
// ================================================================

router.get('/class/:classId/students', asyncHandler(async (req, res) => {
    const classId = normalizeClass(req.params.classId, { required: true });
    const session = normalizeSession(req.query.session);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const baseParams = [classId];
    let sessionClause = '';
    if (session !== null) {
        sessionClause = ' AND ar.session = ?';
        baseParams.push(session);
    }

    // Count
    const countResult = await query(`
        SELECT COUNT(DISTINCT s.id) as total
        FROM students s
        JOIN academic_records ar ON s.id = ar.student_id
        WHERE ar.class = ? ${sessionClause}
    `, baseParams);
    const total = countResult[0]?.total || 0;

    // Data
    const sql = `
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no,
            COUNT(DISTINCT m.id) as marksheet_count,
            SUM(CASE WHEN m.is_published = 1 THEN 1 ELSE 0 END) as published_count
        FROM students s
        JOIN academic_records ar ON s.id = ar.student_id
        LEFT JOIN marksheets m ON s.id = m.student_id AND m.session = ar.session AND m.class = ar.class
        WHERE ar.class = ? ${sessionClause}
        GROUP BY
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no
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

router.post('/marksheets/upload', handleUpload, asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || '').trim();
    const session = normalizeSession(req.body.session);
    const classNum = normalizeClass(req.body.class, { required: true });
    const exam_type = normalizeExamType(req.body.exam_type, { required: true });

    if (!student_id) {
        return res.status(400).json({ success: false, message: 'Student ID is required' });
    }
    if (!session) {
        return res.status(400).json({ success: false, message: 'Session is required' });
    }
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    const students = await query('SELECT id FROM students WHERE student_id = ?', [student_id]);
    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }
    const studentDbId = students[0].id;

    // Ensure academic record exists
    let academicRecords = await query(
        'SELECT id FROM academic_records WHERE student_id = ? AND session = ? AND class = ?',
        [studentDbId, session, classNum]
    );
    let academicRecordId;
    if (academicRecords.length === 0) {
        const result = await query(
            'INSERT INTO academic_records (student_id, session, class) VALUES (?, ?, ?)',
            [studentDbId, session, classNum]
        );
        academicRecordId = result.insertId;
    } else {
        academicRecordId = academicRecords[0].id;
    }

    // Check duplicate
    const existing = await query(
        'SELECT id FROM marksheets WHERE student_id = ? AND session = ? AND class = ? AND exam_type = ?',
        [studentDbId, session, classNum, exam_type]
    );
    if (existing.length > 0) {
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

    await query(`
        INSERT INTO marksheets (
            student_id, academic_record_id, session, class, exam_type,
            cloudinary_public_id, cloudinary_url, original_filename, file_size,
            is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        studentDbId, academicRecordId, session, classNum, exam_type,
        cloudinaryData.public_id, cloudinaryData.secure_url,
        cloudinaryData.original_filename, cloudinaryData.file_size,
        0
    ]);

    res.status(201).json({
        success: true,
        message: 'Marksheet uploaded successfully (Unpublished)',
        data: { cloudinary_url: cloudinaryData.secure_url, status: 'unpublished' }
    });
}));

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
            m.id, m.session, m.class, m.exam_type,
            m.cloudinary_url, m.is_published, m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size,
            s.student_id, s.name, s.father_name,
            ar.exam_roll_no
        FROM marksheets m
        JOIN students s ON m.student_id = s.id
        LEFT JOIN academic_records ar ON m.academic_record_id = ar.id
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
    const countSql = sql.replace(
        /SELECT[\s\S]*?FROM marksheets m/,
        'SELECT COUNT(*) as total FROM marksheets m'
    );
    const countResult = await query(countSql, params);
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

router.get('/marksheets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.class, m.exam_type,
            m.cloudinary_url, m.is_published, m.uploaded_at,
            m.original_filename, m.file_size,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob,
            ar.exam_roll_no
        FROM marksheets m
        JOIN students s ON m.student_id = s.id
        LEFT JOIN academic_records ar ON m.academic_record_id = ar.id
        WHERE m.id = ?
    `, [id]);

    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }
    res.json({ success: true, data: marksheets[0] });
}));

router.put('/marksheets/:id/replace', handleUpload, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
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

    // Delete old file
    if (oldPublicId) {
        try {
            await cloudinary.uploader.destroy(oldPublicId, { resource_type: 'raw' });
        } catch (err) {
            console.error('Cloudinary delete error (non-fatal):', err.message);
        }
    }

    res.json({ success: true, message: 'Marksheet replaced successfully', data: { cloudinary_url: cloudinaryData.secure_url } });
}));

router.delete('/marksheets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
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
            console.error('Cloudinary delete error (non-fatal):', err.message);
        }
    }

    res.json({ success: true, message: 'Marksheet deleted successfully' });
}));

// ================================================================
//  SECTION 4: PUBLISH / UNPUBLISH
// ================================================================

router.post('/marksheets/:id/publish', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const { declaration_date } = req.body;
    if (!declaration_date) {
        return res.status(400).json({ success: false, message: 'Declaration date is required' });
    }
    if (Number.isNaN(Date.parse(declaration_date))) {
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
    if (Number.isNaN(id)) {
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

// Bulk publish
router.post('/marksheets/bulk-publish', asyncHandler(async (req, res) => {
    const { ids, declaration_date } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    if (!declaration_date) {
        return res.status(400).json({ success: false, message: 'Declaration date is required' });
    }

    const cleanIds = ids.map((v) => parseInt(v, 10)).filter((v) => !Number.isNaN(v));
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
        ORDER BY class
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
            m.id, m.exam_type, m.cloudinary_url,
            s.student_id, s.name, s.father_name, s.mother_name,
            ar.exam_roll_no
        FROM marksheets m
        JOIN students s ON m.student_id = s.id
        LEFT JOIN academic_records ar ON m.academic_record_id = ar.id
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
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.photo,
            ar.session, ar.class, ar.section, ar.exam_roll_no
        FROM students s
        LEFT JOIN academic_records ar ON s.id = ar.student_id
        WHERE s.student_id = ? AND DATE(s.dob) = DATE(?)
    `, [student_id, dob]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'No student found with the provided Student ID and DOB' });
    }

    const marksheets = await query(`
        SELECT id, session, class, exam_type, cloudinary_url, uploaded_at
        FROM marksheets
        WHERE student_id = ? AND is_published = 1
        ORDER BY session DESC, exam_type
    `, [students[0].id]);

    res.json({ success: true, data: { student: students[0], marksheets } });
}));

router.get('/public/marksheet/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const marksheets = await query(
        'SELECT cloudinary_url, is_published FROM marksheets WHERE id = ? AND is_published = 1',
        [id]
    );
    if (marksheets.length === 0) {
        return res.status(404).json({ success: false, message: 'Marksheet not found or not published' });
    }
    res.json({ success: true, data: { url: marksheets[0].cloudinary_url } });
}));

router.get('/public/marksheet/:id/download', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    }

    const marksheets = await query(
        'SELECT cloudinary_public_id, original_filename, is_published FROM marksheets WHERE id = ? AND is_published = 1',
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

    res.json({ success: true, data: { download_url: downloadUrl } });
}));

// ================================================================
//  SECTION 6: ADMIN DASHBOARD STATISTICS
// ================================================================

router.get('/dashboard/stats', asyncHandler(async (req, res) => {
    const overallStats = await query(`
        SELECT
            COUNT(DISTINCT student_id) as total_students,
            COUNT(*) as total_marksheets,
            SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) as published_results,
            SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END) as unpublished_results
        FROM marksheets
    `);

    const classStats = await query(`
        SELECT
            class,
            COUNT(DISTINCT student_id) as students,
            COUNT(*) as marksheets,
            SUM(CASE WHEN is_published = 1 THEN 1 ELSE 0 END) as published,
            SUM(CASE WHEN is_published = 0 THEN 1 ELSE 0 END) as unpublished
        FROM marksheets
        GROUP BY class
        ORDER BY class
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
