// ================================================================
//  RESULT MANAGEMENT ROUTES — Nstudent Table Based
//  ✅ Student details from Nstudent table
//  ✅ Marksheets + marks + exam details from marksheets table
// ================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const { query } = require('../config/db');
const cloudinary = require('../config/cloudinary').cloudinary;

const VALID_CLASSES = ['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'];
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

function getSessionVariants(session) {
    if (!session) return [session];
    const variants = [session];
    const match = session.match(/^(\d{4})-(\d{2})$/);
    if (match) {
        const fullEndYear = 2000 + parseInt(match[2]);
        variants.push(`March-${fullEndYear}`, `march-${fullEndYear}`, `MARCH-${fullEndYear}`);
        variants.push(`December-${fullEndYear}`, `december-${fullEndYear}`, `DECEMBER-${fullEndYear}`);
    }
    return variants;
}

function buildSessionClause(column, session, params) {
    if (!session) return '';
    const variants = getSessionVariants(session);
    const placeholders = variants.map(() => '?').join(',');
    params.push(...variants);
    return ` AND ${column} IN (${placeholders})`;
}

function normalizeClass(value, { required = false } = {}) {
    if (value === undefined || value === null || String(value).trim() === '') {
        if (required) throw new Error('Class is required');
        return null;
    }
    const str = String(value).trim();
    if (!VALID_CLASSES.includes(str)) throw new Error('Invalid class');
    return str;
}

function normalizeExamType(value, { required = false } = {}) {
    if (value === undefined || value === null || String(value).trim() === '') {
        if (required) throw new Error('Exam type is required');
        return null;
    }
    const trimmed = String(value).trim();
    if (!VALID_EXAM_TYPES.includes(trimmed)) throw new Error('Invalid exam type');
    return trimmed;
}

// ================================================================
//  CLOUDINARY STORAGE
// ================================================================
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
        const session = normalizeSession(req.body.session) || '2026-27';
        const sessionSafe = session.replace(/[^a-zA-Z0-9-]/g, '-');
        const classStr = normalizeClass(req.body.class) || 'default';
        const studentId = (req.body.student_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
        const examType = (req.body.exam_type || 'exam').replace(/[^a-zA-Z0-9_-]/g, '-');
        return {
            folder: `gsssshilla/marksheets/${sessionSafe}/class-${classStr}`,
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
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF files are allowed'), false);
    }
});

function handleUpload(req, res, next) {
    upload.single('pdf')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: 'File too large. Max 10MB.' });
            }
            return res.status(400).json({ success: false, message: 'Upload error: ' + err.message });
        }
        if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        if (req.file) console.log(`📄 File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);
        next();
    });
}

// ================================================================
//  SECTION 1: STUDENT MANAGEMENT (from Nstudent)
// ================================================================

// GET All Students
router.get('/students', asyncHandler(async (req, res) => {
    const classStr = normalizeClass(req.query.class);
    const session = normalizeSession(req.query.session);
    const { student_id, name } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    let sql = `
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name, s.mother_name,
            s.dob, s.student_photo_url AS photo, s.class, s.session, s.roll_number,
            s.status, s.mobile_number, s.email_id
        FROM Nstudent s
        WHERE 1=1
    `;
    const params = [];

    if (classStr !== null) { sql += ' AND s.class = ?'; params.push(classStr); }
    if (session !== null) { sql += buildSessionClause('s.session', session, params); }
    if (student_id) { sql += ' AND s.student_id LIKE ?'; params.push(`%${student_id}%`); }
    if (name) { sql += ' AND s.name LIKE ?'; params.push(`%${name}%`); }

    let countSql = `SELECT COUNT(*) as total FROM Nstudent s WHERE 1=1`;
    const countParams = [];
    if (classStr !== null) { countSql += ' AND s.class = ?'; countParams.push(classStr); }
    if (session !== null) {
        const variants = getSessionVariants(session);
        countSql += ` AND s.session IN (${variants.map(() => '?').join(',')})`;
        countParams.push(...variants);
    }
    if (student_id) { countSql += ' AND s.student_id LIKE ?'; countParams.push(`%${student_id}%`); }
    if (name) { countSql += ' AND s.name LIKE ?'; countParams.push(`%${name}%`); }

    const countResult = await query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    sql += ' ORDER BY s.name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const students = await query(sql, params);

    res.json({
        success: true,
        data: students,
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) }
    });
}));

// GET Single Student — full details + marksheets
router.get('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, session, roll_number,
            status, mobile_number, email_id, gender, category,
            address, village, post_office, tehsil, district, state, pincode,
            admission_number, admission_date, stream,
            signature_url, aadhar_number,
            aadhar_card_url, himachali_bonafide_url, caste_certificate_url,
            apaar_card_url, previous_marksheet_url, income_certificate_url,
            bpl_certificate_url, other_document_url
        FROM Nstudent
        WHERE student_id = ?
        LIMIT 1
    `, [studentId]);

    if (students.length === 0) {
        return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size
        FROM marksheets m
        WHERE m.student_id = ?
        ORDER BY m.session DESC, m.exam_type
    `, [studentId]);

    res.json({
        success: true,
        data: { student: students[0], marksheets }
    });
}));

// CREATE Student
router.post('/students', asyncHandler(async (req, res) => {
    const {
        student_id, apaar_id, name, father_name, mother_name,
        dob, photo, roll_number, mobile_number, email_id,
        gender, category, address
    } = req.body;

    const session = normalizeSession(req.body.session);
    const classStr = normalizeClass(req.body.class, { required: true });

    if (!student_id || !String(student_id).trim()) return res.status(400).json({ success: false, message: 'Student ID is required' });
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!session) return res.status(400).json({ success: false, message: 'Session is required' });

    const existing = await query('SELECT id FROM Nstudent WHERE student_id = ?', [student_id]);
    if (existing.length > 0) return res.status(409).json({ success: false, message: 'Student ID already exists' });

    const insertResult = await query(`
        INSERT INTO Nstudent (
            student_id, apaar_id, name, father_name, mother_name, dob,
            student_photo_url, class, session, roll_number,
            mobile_number, email_id, gender, category, address
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        student_id, apaar_id || null, name, father_name || null, mother_name || null,
        dob || null, photo || null, classStr, session, roll_number || null,
        mobile_number || null, email_id || null, gender || null, category || null, address || null
    ]);

    res.status(201).json({
        success: true,
        message: 'Student created successfully',
        data: { student_id, id: insertResult.insertId }
    });
}));

// UPDATE Student
router.put('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const {
        apaar_id, name, father_name, mother_name, dob, photo,
        roll_number, mobile_number, email_id, gender, category, address
    } = req.body;
    const session = normalizeSession(req.body.session);
    const classStr = normalizeClass(req.body.class);

    const students = await query('SELECT id FROM Nstudent WHERE student_id = ?', [studentId]);
    if (students.length === 0) return res.status(404).json({ success: false, message: 'Student not found' });

    const updates = [];
    const params = [];
    const setField = (col, val) => { if (val !== undefined) { updates.push(`${col} = ?`); params.push(val); } };

    setField('apaar_id', apaar_id);
    setField('name', name);
    setField('father_name', father_name);
    setField('mother_name', mother_name);
    setField('dob', dob);
    setField('student_photo_url', photo);
    setField('roll_number', roll_number);
    setField('mobile_number', mobile_number);
    setField('email_id', email_id);
    setField('gender', gender);
    setField('category', category);
    setField('address', address);
    if (session !== null) setField('session', session);
    if (classStr !== null) setField('class', classStr);

    if (updates.length === 0) return res.json({ success: true, message: 'No changes' });

    params.push(studentId);
    await query(`UPDATE Nstudent SET ${updates.join(', ')} WHERE student_id = ?`, params);

    res.json({ success: true, message: 'Student updated successfully' });
}));

// DELETE Student
router.delete('/students/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query('SELECT id FROM Nstudent WHERE student_id = ?', [studentId]);
    if (students.length === 0) return res.status(404).json({ success: false, message: 'Student not found' });

    const marksheets = await query('SELECT cloudinary_public_id FROM marksheets WHERE student_id = ?', [studentId]);

    await query('DELETE FROM Nstudent WHERE student_id = ?', [studentId]);

    for (const m of marksheets) {
        if (m.cloudinary_public_id) {
            try { await cloudinary.uploader.destroy(m.cloudinary_public_id, { resource_type: 'raw' }); }
            catch (err) { console.error('Cloudinary cleanup error:', err.message); }
        }
    }

    res.json({ success: true, message: 'Student deleted successfully' });
}));

// SEARCH Student
router.get('/students/search/:studentId', asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const students = await query(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, session, roll_number, status
        FROM Nstudent
        WHERE student_id = ?
    `, [studentId]);

    if (students.length === 0) return res.status(404).json({ success: false, message: 'Student not found' });

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.uploaded_at
        FROM marksheets m
        WHERE m.student_id = ?
        ORDER BY m.session DESC, m.exam_type
    `, [studentId]);

    res.json({ success: true, data: { student: students[0], marksheets } });
}));

// ================================================================
//  SECTION 2: CLASS-WISE MANAGEMENT
// ================================================================

router.get('/class/:classId/students', asyncHandler(async (req, res) => {
    const classStr = normalizeClass(req.params.classId, { required: true });
    const session = normalizeSession(req.query.session);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const baseParams = [classStr];
    let sessionClause = '';
    if (session !== null) sessionClause = buildSessionClause('s.session', session, baseParams);

    const countResult = await query(`SELECT COUNT(*) as total FROM Nstudent s WHERE s.class = ? ${sessionClause}`, baseParams);
    const total = countResult[0]?.total || 0;

    const sql = `
        SELECT
            s.id, s.student_id, s.apaar_id, s.name, s.father_name,
            s.mother_name, s.dob, s.student_photo_url AS photo,
            s.class, s.session, s.roll_number, s.status,
            (SELECT COUNT(*) FROM marksheets m WHERE m.student_id = s.student_id) AS marksheet_count,
            (SELECT COUNT(*) FROM marksheets m WHERE m.student_id = s.student_id AND m.is_published = 1) AS published_count
        FROM Nstudent s
        WHERE s.class = ? ${sessionClause}
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

// Upload marksheet
router.post('/marksheets/upload', handleUpload, asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || '').trim();
    const session = normalizeSession(req.body.session);
    const classStr = normalizeClass(req.body.class, { required: true });
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
    if (!req.file) return res.status(400).json({ success: false, message: 'PDF file is required' });

    const students = await query('SELECT id FROM Nstudent WHERE student_id = ?', [student_id]);
    if (students.length === 0) { await cleanupFile(); return res.status(404).json({ success: false, message: 'Student not found' }); }

    const existing = await query(
        'SELECT id FROM marksheets WHERE student_id = ? AND session = ? AND class = ? AND exam_type = ?',
        [student_id, session, classStr, exam_type]
    );
    if (existing.length > 0) { await cleanupFile(); return res.status(409).json({ success: false, message: 'Marksheet already exists' }); }

    const insertResult = await query(`
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
        message: 'Marksheet uploaded successfully (Unpublished)',
        data: {
            cloudinary_url: req.file.path,
            status: 'unpublished',
            marksheet_id: insertResult.insertId,
            exam_session: exam_session || null,
            obtained_marks, max_marks
        }
    });
}));

// Get all marksheets
router.get('/marksheets', asyncHandler(async (req, res) => {
    const student_id = req.query.student_id;
    const session = normalizeSession(req.query.session);
    const classStr = normalizeClass(req.query.class);
    const exam_type = normalizeExamType(req.query.exam_type);
    const is_published = req.query.is_published;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    let sql = `
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.uploaded_at, m.updated_at,
            m.original_filename, m.file_size,
            s.student_id, s.name, s.father_name, s.roll_number
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        WHERE 1=1
    `;
    const params = [];

    if (student_id) { sql += ' AND s.student_id LIKE ?'; params.push(`%${student_id}%`); }
    if (session !== null) sql += buildSessionClause('m.session', session, params);
    if (classStr !== null) { sql += ' AND m.class = ?'; params.push(classStr); }
    if (exam_type !== null) { sql += ' AND m.exam_type = ?'; params.push(exam_type); }
    if (is_published !== undefined && is_published !== '') {
        sql += ' AND m.is_published = ?';
        params.push(is_published === 'true' || is_published === '1' ? 1 : 0);
    }

    let countSql = `SELECT COUNT(*) as total FROM marksheets m JOIN Nstudent s ON m.student_id = s.student_id WHERE 1=1`;
    const countParams = [];
    if (student_id) { countSql += ' AND s.student_id LIKE ?'; countParams.push(`%${student_id}%`); }
    if (session !== null) {
        const variants = getSessionVariants(session);
        countSql += ` AND m.session IN (${variants.map(() => '?').join(',')})`;
        countParams.push(...variants);
    }
    if (classStr !== null) { countSql += ' AND m.class = ?'; countParams.push(classStr); }
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

// Get single marksheet
router.get('/marksheets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid marksheet id' });

    const marksheets = await query(`
        SELECT
            m.id, m.session, m.exam_session, m.class, m.exam_type,
            m.obtained_marks, m.max_marks,
            m.cloudinary_url, m.is_published, m.uploaded_at,
            m.original_filename, m.file_size,
            s.student_id, s.name, s.father_name, s.mother_name, s.dob, s.roll_number
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        WHERE m.id = ?
    `, [id]);

    if (marksheets.length === 0) return res.status(404).json({ success: false, message: 'Marksheet not found' });
    res.json({ success: true, data: marksheets[0] });
}));

// Replace marksheet
router.put('/marksheets/:id/replace', handleUpload, asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid marksheet id' });
    if (!req.file) return res.status(400).json({ success: false, message: 'PDF file is required' });

    const marksheets = await query('SELECT cloudinary_public_id FROM marksheets WHERE id = ?', [id]);
    if (marksheets.length === 0) {
        try { await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'raw' }); } catch (e) {}
        return res.status(404).json({ success: false, message: 'Marksheet not found' });
    }

    const oldPublicId = marksheets[0].cloudinary_public_id;

    await query(`
        UPDATE marksheets
        SET cloudinary_public_id = ?, cloudinary_url = ?,
            original_filename = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [req.file.filename, req.file.path, req.file.originalname, req.file.size, id]);

    if (oldPublicId) {
        try { await cloudinary.uploader.destroy(oldPublicId, { resource_type: 'raw' }); } catch (err) {}
    }

    res.json({ success: true, message: 'Marksheet replaced successfully', data: { cloudinary_url: req.file.path } });
}));

// Delete marksheet
router.delete('/marksheets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid marksheet id' });

    const marksheets = await query('SELECT cloudinary_public_id FROM marksheets WHERE id = ?', [id]);
    if (marksheets.length === 0) return res.status(404).json({ success: false, message: 'Marksheet not found' });

    await query('DELETE FROM marksheets WHERE id = ?', [id]);

    if (marksheets[0].cloudinary_public_id) {
        try { await cloudinary.uploader.destroy(marksheets[0].cloudinary_public_id, { resource_type: 'raw' }); } catch (err) {}
    }

    res.json({ success: true, message: 'Marksheet deleted successfully' });
}));

// ================================================================
//  SECTION 4: PUBLISH / UNPUBLISH
// ================================================================

router.post('/marksheets/:id/publish', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid marksheet id' });

    const { declaration_date } = req.body;
    if (!declaration_date) return res.status(400).json({ success: false, message: 'Declaration date is required' });
    if (isNaN(Date.parse(declaration_date))) return res.status(400).json({ success: false, message: 'Invalid declaration date' });

    const result = await query(
        `UPDATE marksheets SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [declaration_date, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Marksheet not found' });

    res.json({ success: true, message: 'Marksheet published successfully', data: { declaration_date } });
}));

router.post('/marksheets/:id/unpublish', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid marksheet id' });

    const result = await query('UPDATE marksheets SET is_published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Marksheet not found' });

    res.json({ success: true, message: 'Marksheet unpublished successfully' });
}));

router.post('/marksheets/bulk-publish', asyncHandler(async (req, res) => {
    const { ids, declaration_date } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'ids array is required' });
    if (!declaration_date) return res.status(400).json({ success: false, message: 'Declaration date is required' });

    const cleanIds = ids.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    if (cleanIds.length === 0) return res.status(400).json({ success: false, message: 'No valid marksheet ids' });

    const placeholders = cleanIds.map(() => '?').join(',');
    const result = await query(
        `UPDATE marksheets SET is_published = 1, declaration_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
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
        ORDER BY FIELD(class,'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')
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
    const classStr = normalizeClass(req.params.class, { required: true });
    if (!session) return res.status(400).json({ success: false, message: 'Session is required' });

    const sessionVariants = getSessionVariants(session);
    const placeholders = sessionVariants.map(() => '?').join(',');

    const results = await query(`
        SELECT
            m.id, m.exam_type, m.obtained_marks, m.max_marks, m.cloudinary_url,
            s.student_id, s.name, s.father_name, s.mother_name, s.roll_number
        FROM marksheets m
        JOIN Nstudent s ON m.student_id = s.student_id
        WHERE m.session IN (${placeholders}) AND m.class = ? AND m.is_published = 1
        ORDER BY s.name
    `, [...sessionVariants, classStr]);

    res.json({ success: true, data: results });
}));

router.post('/public/search', asyncHandler(async (req, res) => {
    const student_id = (req.body.student_id || '').trim();
    const dob = req.body.dob;

    if (!student_id || !dob) return res.status(400).json({ success: false, message: 'Student ID and Date of Birth are required' });

    const students = await query(`
        SELECT
            id, student_id, apaar_id, name, father_name, mother_name,
            dob, student_photo_url AS photo, class, session, roll_number, status
        FROM Nstudent
        WHERE student_id = ? AND DATE(dob) = DATE(?)
    `, [student_id, dob]);

    if (students.length === 0) return res.status(404).json({ success: false, message: 'No student found with the provided details' });

    const marksheets = await query(`
        SELECT id, session, exam_session, class, exam_type, obtained_marks, max_marks, cloudinary_url, uploaded_at
        FROM marksheets
        WHERE student_id = ? AND is_published = 1
        ORDER BY session DESC, exam_type
    `, [student_id]);

    res.json({ success: true, data: { student: students[0], marksheets } });
}));

// ================================================================
//  PUBLIC MARKSHEET VIEW / DOWNLOAD
// ================================================================

router.get('/public/marksheet/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid marksheet ID' });

    const marksheets = await query(
        `SELECT cloudinary_url FROM marksheets WHERE id = ? AND is_published = 1`,
        [id]
    );

    if (marksheets.length === 0) return res.status(404).json({ success: false, message: 'Marksheet not found or not published' });

    return res.redirect(marksheets[0].cloudinary_url);
}));

router.get('/public/marksheet/:id/download', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid marksheet ID' });

    const marksheets = await query(
        `SELECT cloudinary_public_id, original_filename FROM marksheets WHERE id = ? AND is_published = 1`,
        [id]
    );

    if (marksheets.length === 0) return res.status(404).json({ success: false, message: 'Marksheet not found or not published' });

    const downloadUrl = cloudinary.url(marksheets[0].cloudinary_public_id, {
        resource_type: 'raw',
        flags: 'attachment',
        filename: marksheets[0].original_filename || 'marksheet.pdf'
    });

    return res.redirect(downloadUrl);
}));

// ================================================================
//  SECTION 6: DASHBOARD STATS
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
        ORDER BY FIELD(class,'Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12')
    `);

    res.json({
        success: true,
        data: {
            overall: overallStats[0] || { total_students: 0, total_marksheets: 0, published_results: 0, unpublished_results: 0 },
            class_wise: classStats || []
        }
    });
}));

module.exports = router;
