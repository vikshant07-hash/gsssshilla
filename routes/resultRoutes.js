// ================================================================
//  COMPLETE RESULT MANAGEMENT ROUTES - CORRECTED
// ================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// ✅ Import from your existing db.js
const { query } = require("../config/db");
const cloudinary = require("../config/cloudinary").cloudinary;

// ================================================================
//  CLOUDINARY STORAGE CONFIGURATION
// ================================================================

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: (req, file) => {
            const session = req.body.session || '2025-26';
            const classNum = req.body.class || 'default';
            return `school-results/marksheets/${session}/class-${classNum}`;
        },
        resource_type: 'raw',
        public_id: (req, file) => {
            const studentId = req.body.student_id || 'unknown';
            const examType = req.body.exam_type || 'exam';
            const timestamp = Date.now();
            return `${studentId}-${examType}-${timestamp}`;
        },
        format: 'pdf'
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// ================================================================
//  SECTION 1: STUDENT MANAGEMENT
// ================================================================

router.get('/students', async (req, res) => {
    try {
        const {
            class: classNum,
            session,
            student_id,
            name,
            page = 1,
            limit = 20
        } = req.query;

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

        if (classNum) {
            sql += ' AND ar.class = ?';
            params.push(classNum);
        }
        if (session) {
            sql += ' AND ar.session = ?';
            params.push(session);
        }
        if (student_id) {
            sql += ' AND s.student_id LIKE ?';
            params.push(`%${student_id}%`);
        }
        if (name) {
            sql += ' AND s.name LIKE ?';
            params.push(`%${name}%`);
        }

        sql += ' GROUP BY s.id, ar.session, ar.class, ar.section, ar.exam_roll_no';
        sql += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const students = await query(sql, params);

        res.json({
            success: true,
            data: students,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('❌ Error fetching students:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch students'
        });
    }
});

router.get('/students/:studentId', async (req, res) => {
    try {
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
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const marksheets = await query(`
            SELECT
                m.id, m.session, m.class, m.exam_type,
                m.cloudinary_url, m.is_published, m.uploaded_at,
                m.original_filename, m.file_size
            FROM marksheets m
            WHERE m.student_id = ?
            ORDER BY m.session DESC, m.exam_type
        `, [students[0].id]);

        res.json({
            success: true,
            data: {
                student: students[0],
                marksheets: marksheets
            }
        });
    } catch (error) {
        console.error('❌ Error fetching student:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch student'
        });
    }
});

router.post('/students', async (req, res) => {
    try {
        const {
            student_id,
            apaar_id,
            name,
            father_name,
            mother_name,
            dob,
            photo,
            session,
            class: classNum,
            section,
            exam_roll_no
        } = req.body;

        if (!student_id || !name || !session || !classNum) {
            return res.status(400).json({
                success: false,
                message: 'Student ID, Name, Session, and Class are required'
            });
        }

        const existing = await query(
            'SELECT id FROM students WHERE student_id = ?',
            [student_id]
        );
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Student ID already exists'
            });
        }

        const studentResult = await query(`
            INSERT INTO students
                (student_id, apaar_id, name, father_name, mother_name, dob, photo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [student_id, apaar_id, name, father_name, mother_name, dob, photo]);

        const studentDbId = studentResult.insertId;

        await query(`
            INSERT INTO academic_records
                (student_id, session, class, section, exam_roll_no)
            VALUES (?, ?, ?, ?, ?)
        `, [studentDbId, session, classNum, section, exam_roll_no]);

        res.status(201).json({
            success: true,
            message: 'Student created successfully',
            data: { student_id, id: studentDbId }
        });
    } catch (error) {
        console.error('❌ Error creating student:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create student'
        });
    }
});

router.put('/students/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const {
            apaar_id,
            name,
            father_name,
            mother_name,
            dob,
            photo,
            session,
            class: classNum,
            section,
            exam_roll_no
        } = req.body;

        const students = await query(
            'SELECT id FROM students WHERE student_id = ?',
            [studentId]
        );
        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const studentDbId = students[0].id;

        await query(`
            UPDATE students
            SET apaar_id = ?, name = ?, father_name = ?, mother_name = ?,
                dob = ?, photo = ?
            WHERE student_id = ?
        `, [apaar_id, name, father_name, mother_name, dob, photo, studentId]);

        await query(`
            UPDATE academic_records
            SET session = ?, class = ?, section = ?, exam_roll_no = ?
            WHERE student_id = ?
        `, [session, classNum, section, exam_roll_no, studentDbId]);

        res.json({
            success: true,
            message: 'Student updated successfully'
        });
    } catch (error) {
        console.error('❌ Error updating student:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update student'
        });
    }
});

router.delete('/students/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        const students = await query(
            'SELECT id FROM students WHERE student_id = ?',
            [studentId]
        );
        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const marksheets = await query(
            'SELECT cloudinary_public_id FROM marksheets WHERE student_id = ?',
            [students[0].id]
        );
        for (const m of marksheets) {
            if (m.cloudinary_public_id) {
                try {
                    await cloudinary.uploader.destroy(m.cloudinary_public_id, {
                        resource_type: 'raw'
                    });
                } catch (err) {
                    console.error('Cloudinary delete error:', err);
                }
            }
        }

        await query('DELETE FROM students WHERE student_id = ?', [studentId]);

        res.json({
            success: true,
            message: 'Student deleted successfully'
        });
    } catch (error) {
        console.error('❌ Error deleting student:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete student'
        });
    }
});

router.get('/students/search/:studentId', async (req, res) => {
    try {
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
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
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
            data: {
                student: students[0],
                marksheets: marksheets
            }
        });
    } catch (error) {
        console.error('❌ Error searching student:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search student'
        });
    }
});

// ================================================================
//  SECTION 2: CLASS-WISE MANAGEMENT
// ================================================================

router.get('/class/:classId/students', async (req, res) => {
    try {
        const { classId } = req.params;
        const { session, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let sql = `
            SELECT
                s.id, s.student_id, s.apaar_id, s.name, s.father_name,
                s.mother_name, s.dob, s.photo,
                ar.session, ar.class, ar.section, ar.exam_roll_no,
                COUNT(m.id) as marksheet_count,
                SUM(CASE WHEN m.is_published = TRUE THEN 1 ELSE 0 END) as published_count
            FROM students s
            LEFT JOIN academic_records ar ON s.id = ar.student_id
            LEFT JOIN marksheets m ON s.id = m.student_id
            WHERE ar.class = ?
        `;
        const params = [classId];

        if (session) {
            sql += ' AND ar.session = ?';
            params.push(session);
        }

        sql += `
            GROUP BY
                s.id, s.student_id, s.apaar_id, s.name, s.father_name,
                s.mother_name, s.dob, s.photo,
                ar.session, ar.class, ar.section, ar.exam_roll_no
            ORDER BY s.name
            LIMIT ? OFFSET ?
        `;
        params.push(parseInt(limit), parseInt(offset));

        const students = await query(sql, params);

        res.json({
            success: true,
            data: students,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('❌ Error fetching class students:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch students'
        });
    }
});

// ================================================================
//  SECTION 3: MARKSHEET MANAGEMENT
// ================================================================

router.post('/marksheets/upload', upload.single('pdf'), async (req, res) => {
    try {
        const { student_id, session, class: classNum, exam_type } = req.body;

        if (!student_id || !session || !classNum || !exam_type) {
            return res.status(400).json({
                success: false,
                message: 'Student ID, Session, Class, and Exam Type are required'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'PDF file is required'
            });
        }

        const validClasses = [6, 7, 8, 9, 10, 11, 12];
        if (!validClasses.includes(parseInt(classNum))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class. Must be 6-12'
            });
        }

        const students = await query(
            'SELECT id FROM students WHERE student_id = ?',
            [student_id]
        );
        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const studentDbId = students[0].id;

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
            false
        ]);

        res.status(201).json({
            success: true,
            message: 'Marksheet uploaded successfully (Unpublished)',
            data: {
                cloudinary_url: cloudinaryData.secure_url,
                status: 'unpublished'
            }
        });
    } catch (error) {
        console.error('❌ Error uploading marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload marksheet'
        });
    }
});

router.get('/marksheets', async (req, res) => {
    try {
        const {
            student_id,
            session,
            class: classNum,
            exam_type,
            is_published,
            page = 1,
            limit = 20
        } = req.query;

        const offset = (page - 1) * limit;
        let sql = `
            SELECT
                m.id, m.session, m.class, m.exam_type,
                m.cloudinary_url, m.is_published, m.uploaded_at,
                m.original_filename, m.file_size,
                s.student_id, s.name, s.father_name,
                ar.exam_roll_no
            FROM marksheets m
            JOIN students s ON m.student_id = s.id
            JOIN academic_records ar ON m.academic_record_id = ar.id
            WHERE 1=1
        `;
        const params = [];

        if (student_id) {
            sql += ' AND s.student_id LIKE ?';
            params.push(`%${student_id}%`);
        }
        if (session) {
            sql += ' AND m.session = ?';
            params.push(session);
        }
        if (classNum) {
            sql += ' AND m.class = ?';
            params.push(classNum);
        }
        if (exam_type) {
            sql += ' AND m.exam_type LIKE ?';
            params.push(`%${exam_type}%`);
        }
        if (is_published !== undefined) {
            sql += ' AND m.is_published = ?';
            params.push(is_published === 'true');
        }

        sql += ' ORDER BY m.uploaded_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const marksheets = await query(sql, params);

        res.json({
            success: true,
            data: marksheets,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('❌ Error fetching marksheets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch marksheets'
        });
    }
});

router.get('/marksheets/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const marksheets = await query(`
            SELECT
                m.id, m.session, m.class, m.exam_type,
                m.cloudinary_url, m.is_published, m.uploaded_at,
                m.original_filename, m.file_size,
                s.student_id, s.name, s.father_name, s.mother_name, s.dob,
                ar.exam_roll_no
            FROM marksheets m
            JOIN students s ON m.student_id = s.id
            JOIN academic_records ar ON m.academic_record_id = ar.id
            WHERE m.id = ?
        `, [id]);

        if (marksheets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found'
            });
        }

        res.json({
            success: true,
            data: marksheets[0]
        });
    } catch (error) {
        console.error('❌ Error fetching marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch marksheet'
        });
    }
});

router.put('/marksheets/:id/replace', upload.single('pdf'), async (req, res) => {
    try {
        const { id } = req.params;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'PDF file is required'
            });
        }

        const marksheets = await query(
            'SELECT cloudinary_public_id FROM marksheets WHERE id = ?',
            [id]
        );
        if (marksheets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found'
            });
        }

        if (marksheets[0].cloudinary_public_id) {
            try {
                await cloudinary.uploader.destroy(marksheets[0].cloudinary_public_id, {
                    resource_type: 'raw'
                });
            } catch (err) {
                console.error('Cloudinary delete error:', err);
            }
        }

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
        `, [
            cloudinaryData.public_id, cloudinaryData.secure_url,
            cloudinaryData.original_filename, cloudinaryData.file_size,
            id
        ]);

        res.json({
            success: true,
            message: 'Marksheet replaced successfully',
            data: { cloudinary_url: cloudinaryData.secure_url }
        });
    } catch (error) {
        console.error('❌ Error replacing marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to replace marksheet'
        });
    }
});

router.delete('/marksheets/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const marksheets = await query(
            'SELECT cloudinary_public_id FROM marksheets WHERE id = ?',
            [id]
        );
        if (marksheets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found'
            });
        }

        if (marksheets[0].cloudinary_public_id) {
            try {
                await cloudinary.uploader.destroy(marksheets[0].cloudinary_public_id, {
                    resource_type: 'raw'
                });
            } catch (err) {
                console.error('Cloudinary delete error:', err);
            }
        }

        await query('DELETE FROM marksheets WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Marksheet deleted successfully'
        });
    } catch (error) {
        console.error('❌ Error deleting marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete marksheet'
        });
    }
});

// ================================================================
//  SECTION 4: PUBLISH / UNPUBLISH - ✅ CORRECTED
// ================================================================

router.post('/marksheets/:id/publish', async (req, res) => {
    try {
        const { id } = req.params;
        const { declaration_date } = req.body;

        if (!declaration_date) {
            return res.status(400).json({
                success: false,
                message: 'Declaration date is required'
            });
        }

        // ✅ FIX: Use 'query' not 'db.query'
        const result = await query(
            `UPDATE marksheets 
             SET is_published = TRUE, 
                 declaration_date = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [declaration_date, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found'
            });
        }

        res.json({
            success: true,
            message: 'Marksheet published successfully',
            data: { declaration_date }
        });
    } catch (error) {
        console.error('Error publishing marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to publish marksheet' });
    }
});

router.post('/marksheets/:id/unpublish', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            'UPDATE marksheets SET is_published = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found'
            });
        }

        res.json({
            success: true,
            message: 'Marksheet unpublished successfully'
        });
    } catch (error) {
        console.error('❌ Error unpublishing marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to unpublish marksheet'
        });
    }
});

// ================================================================
//  SECTION 5: PUBLIC RESULT APIS
// ================================================================

router.get('/public/classes', async (req, res) => {
    try {
        const classes = await query(`
            SELECT 
                class,
                COUNT(*) as total_published,
                MAX(declaration_date) as declared_date,
                (SELECT exam_type FROM marksheets m2 
                 WHERE m2.class = m.class AND m2.is_published = TRUE 
                 ORDER BY m2.declaration_date DESC LIMIT 1) as latest_exam_type
            FROM marksheets m
            WHERE is_published = TRUE
            GROUP BY class
            HAVING COUNT(*) > 0
            ORDER BY class
        `);
        
        const formattedData = classes.map(c => ({
            class: c.class,
            total_published: c.total_published,
            exam_type: c.latest_exam_type || 'Various',
            declared_date: c.declared_date ? 
                new Date(c.declared_date).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }) : null
        }));
        
        res.json({ success: true, data: formattedData });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch classes' });
    }
});

router.get('/public/:session/:class', async (req, res) => {
    try {
        const { session, class: classNum } = req.params;

        const results = await query(`
            SELECT
                m.id, m.exam_type, m.cloudinary_url,
                s.student_id, s.name, s.father_name, s.mother_name,
                ar.exam_roll_no
            FROM marksheets m
            JOIN students s ON m.student_id = s.id
            JOIN academic_records ar ON m.academic_record_id = ar.id
            WHERE m.session = ? AND m.class = ? AND m.is_published = TRUE
            ORDER BY s.name
        `, [session, classNum]);

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('❌ Error fetching public results:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch results'
        });
    }
});

router.post('/public/search', async (req, res) => {
    try {
        const { student_id, dob } = req.body;

        if (!student_id || !dob) {
            return res.status(400).json({
                success: false,
                message: 'Student ID and Date of Birth are required'
            });
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
            return res.status(404).json({
                success: false,
                message: 'No student found with the provided Student ID and DOB'
            });
        }

        const marksheets = await query(`
            SELECT
                m.id, m.session, m.class, m.exam_type,
                m.cloudinary_url, m.uploaded_at
            FROM marksheets m
            WHERE m.student_id = ? AND m.is_published = TRUE
            ORDER BY m.session DESC, m.exam_type
        `, [students[0].id]);

        res.json({
            success: true,
            data: {
                student: students[0],
                marksheets: marksheets
            }
        });
    } catch (error) {
        console.error('❌ Error searching public results:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search results'
        });
    }
});

router.get('/public/marksheet/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const marksheets = await query(`
            SELECT cloudinary_url, is_published
            FROM marksheets
            WHERE id = ? AND is_published = TRUE
        `, [id]);

        if (marksheets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found or not published'
            });
        }

        res.json({
            success: true,
            data: {
                url: marksheets[0].cloudinary_url
            }
        });
    } catch (error) {
        console.error('❌ Error fetching marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch marksheet'
        });
    }
});

router.get('/public/marksheet/:id/download', async (req, res) => {
    try {
        const { id } = req.params;

        const marksheets = await query(`
            SELECT cloudinary_public_id, original_filename, is_published
            FROM marksheets
            WHERE id = ? AND is_published = TRUE
        `, [id]);

        if (marksheets.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Marksheet not found or not published'
            });
        }

        const downloadUrl = cloudinary.url(marksheets[0].cloudinary_public_id, {
            resource_type: 'raw',
            flags: 'attachment',
            filename: marksheets[0].original_filename || 'marksheet.pdf'
        });

        res.json({
            success: true,
            data: {
                download_url: downloadUrl
            }
        });
    } catch (error) {
        console.error('❌ Error downloading marksheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to download marksheet'
        });
    }
});

// ================================================================
//  SECTION 6: ADMIN DASHBOARD STATISTICS
// ================================================================

router.get('/dashboard/stats', async (req, res) => {
    try {
        const overallStats = await query(`
            SELECT
                COUNT(DISTINCT student_id) as total_students,
                COUNT(*) as total_marksheets,
                SUM(CASE WHEN is_published = TRUE THEN 1 ELSE 0 END) as published_results,
                SUM(CASE WHEN is_published = FALSE THEN 1 ELSE 0 END) as unpublished_results
            FROM marksheets
        `);

        const classStats = await query(`
            SELECT
                class,
                COUNT(DISTINCT student_id) as students,
                COUNT(*) as marksheets,
                SUM(CASE WHEN is_published = TRUE THEN 1 ELSE 0 END) as published,
                SUM(CASE WHEN is_published = FALSE THEN 1 ELSE 0 END) as unpublished
            FROM marksheets
            GROUP BY class
            ORDER BY class
        `);

        res.json({
            success: true,
            data: {
                overall: overallStats[0] || {
                    total_students: 0,
                    total_marksheets: 0,
                    published_results: 0,
                    unpublished_results: 0
                },
                class_wise: classStats || []
            }
        });
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics'
        });
    }
});

module.exports = router;
