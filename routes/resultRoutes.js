const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const db = require('../config/db'); // Your existing DB connection

// Configure Cloudinary storage for multer
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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// ============================================
// ADMIN STUDENT MANAGEMENT
// ============================================

// Get all students with filters
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
        let query = `
            SELECT DISTINCT 
                s.id, s.student_id, s.apaar_id, s.name, s.father_name, 
                s.mother_name, s.dob, s.photo,
                ar.session, ar.class, ar.section, ar.exam_roll_no
            FROM students s
            LEFT JOIN academic_records ar ON s.id = ar.student_id
            WHERE 1=1
        `;
        const params = [];
        
        if (classNum) {
            query += ' AND ar.class = ?';
            params.push(classNum);
        }
        if (session) {
            query += ' AND ar.session = ?';
            params.push(session);
        }
        if (student_id) {
            query += ' AND s.student_id LIKE ?';
            params.push(`%${student_id}%`);
        }
        if (name) {
            query += ' AND s.name LIKE ?';
            params.push(`%${name}%`);
        }
        
        query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [students] = await db.query(query, params);
        
        // Get count for pagination
        let countQuery = `
            SELECT COUNT(DISTINCT s.id) as total 
            FROM students s
            LEFT JOIN academic_records ar ON s.id = ar.student_id
            WHERE 1=1
        `;
        const countParams = [];
        // Add same filters to count query...
        
        res.json({
            success: true,
            data: students,
            pagination: { page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch students' });
    }
});

// Get single student by ID
router.get('/students/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        
        const [students] = await db.query(`
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
        
        // Get marksheets
        const [marksheets] = await db.query(`
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
        console.error('Error fetching student:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch student' });
    }
});

// Create student
router.post('/students', async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const { 
            student_id, apaar_id, name, father_name, mother_name, 
            dob, photo, session, class: classNum, section, exam_roll_no 
        } = req.body;
        
        // Validate required fields
        if (!student_id || !name || !session || !classNum) {
            return res.status(400).json({ 
                success: false, 
                message: 'Student ID, Name, Session, and Class are required' 
            });
        }
        
        // Check if student_id already exists
        const [existing] = await connection.query(
            'SELECT id FROM students WHERE student_id = ?', 
            [student_id]
        );
        if (existing.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Student ID already exists' 
            });
        }
        
        // Insert student
        const [studentResult] = await connection.query(`
            INSERT INTO students (student_id, apaar_id, name, father_name, mother_name, dob, photo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [student_id, apaar_id, name, father_name, mother_name, dob, photo]);
        
        const studentId = studentResult.insertId;
        
        // Insert academic record
        await connection.query(`
            INSERT INTO academic_records (student_id, session, class, section, exam_roll_no)
            VALUES (?, ?, ?, ?, ?)
        `, [studentId, session, classNum, section, exam_roll_no]);
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Student created successfully',
            data: { student_id, id: studentId }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating student:', error);
        res.status(500).json({ success: false, message: 'Failed to create student' });
    } finally {
        connection.release();
    }
});

// Update student
router.put('/students/:studentId', async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const { studentId } = req.params;
        const { 
            apaar_id, name, father_name, mother_name, 
            dob, photo, session, class: classNum, section, exam_roll_no 
        } = req.body;
        
        // Check if student exists
        const [students] = await connection.query(
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
        
        // Update student
        await connection.query(`
            UPDATE students 
            SET apaar_id = ?, name = ?, father_name = ?, mother_name = ?, dob = ?, photo = ?
            WHERE student_id = ?
        `, [apaar_id, name, father_name, mother_name, dob, photo, studentId]);
        
        // Update academic record
        await connection.query(`
            UPDATE academic_records 
            SET session = ?, class = ?, section = ?, exam_roll_no = ?
            WHERE student_id = ?
        `, [session, classNum, section, exam_roll_no, studentDbId]);
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Student updated successfully'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating student:', error);
        res.status(500).json({ success: false, message: 'Failed to update student' });
    } finally {
        connection.release();
    }
});

// Delete student
router.delete('/students/:studentId', async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const { studentId } = req.params;
        
        // Get student
        const [students] = await connection.query(
            'SELECT id FROM students WHERE student_id = ?', 
            [studentId]
        );
        if (students.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        // Delete marksheets from Cloudinary
        const [marksheets] = await connection.query(
            'SELECT cloudinary_public_id FROM marksheets WHERE student_id = ?',
            [students[0].id]
        );
        
        for (const marksheet of marksheets) {
            if (marksheet.cloudinary_public_id) {
                try {
                    await cloudinary.uploader.destroy(marksheet.cloudinary_public_id, {
                        resource_type: 'raw'
                    });
                } catch (err) {
                    console.error('Failed to delete Cloudinary file:', err);
                }
            }
        }
        
        // Student will be deleted via CASCADE
        await connection.query(
            'DELETE FROM students WHERE student_id = ?', 
            [studentId]
        );
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Student and all associated data deleted successfully'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting student:', error);
        res.status(500).json({ success: false, message: 'Failed to delete student' });
    } finally {
        connection.release();
    }
});

// Search student by ID (admin)
router.get('/students/search/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        
        const [students] = await db.query(`
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
        
        const [marksheets] = await db.query(`
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
        console.error('Error searching student:', error);
        res.status(500).json({ success: false, message: 'Failed to search student' });
    }
});

// ============================================
// CLASS-WISE MANAGEMENT
// ============================================

// Get class-wise students
router.get('/class/:classId/students', async (req, res) => {
    try {
        const { classId } = req.params;
        const { session, page = 1, limit = 20 } = req.query;
        
        const offset = (page - 1) * limit;
        let query = `
            SELECT DISTINCT 
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
            query += ' AND ar.session = ?';
            params.push(session);
        }
        
        query += ' GROUP BY s.id ORDER BY s.name LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [students] = await db.query(query, params);
        
        res.json({
            success: true,
            data: students,
            pagination: { page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('Error fetching class students:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch students' });
    }
});

// Get class-wise marksheets
router.get('/class/:classId/marksheets', async (req, res) => {
    try {
        const { classId } = req.params;
        const { session, exam_type, is_published, page = 1, limit = 20 } = req.query;
        
        const offset = (page - 1) * limit;
        let query = `
            SELECT 
                m.id, m.session, m.class, m.exam_type, 
                m.cloudinary_url, m.is_published, m.uploaded_at,
                s.student_id, s.name, s.father_name,
                ar.exam_roll_no
            FROM marksheets m
            JOIN students s ON m.student_id = s.id
            JOIN academic_records ar ON m.academic_record_id = ar.id
            WHERE m.class = ?
        `;
        const params = [classId];
        
        if (session) {
            query += ' AND m.session = ?';
            params.push(session);
        }
        if (exam_type) {
            query += ' AND m.exam_type LIKE ?';
            params.push(`%${exam_type}%`);
        }
        if (is_published !== undefined) {
            query += ' AND m.is_published = ?';
            params.push(is_published === 'true');
        }
        
        query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [marksheets] = await db.query(query, params);
        
        res.json({
            success: true,
            data: marksheets,
            pagination: { page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('Error fetching marksheets:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch marksheets' });
    }
});

// ============================================
// MARKSHEET MANAGEMENT
// ============================================

// Upload marksheet
router.post('/marksheets/upload', upload.single('pdf'), async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const { student_id, session, class: classNum, exam_type } = req.body;
        
        // Validate required fields
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
        
        // Validate class
        const validClasses = [6, 7, 8, 9, 10, 11, 12];
        if (!validClasses.includes(parseInt(classNum))) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid class. Must be 6-12' 
            });
        }
        
        // Get student
        const [students] = await connection.query(
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
        
        // Get or create academic record
        let [academicRecords] = await connection.query(
            'SELECT id FROM academic_records WHERE student_id = ? AND session = ? AND class = ?',
            [studentDbId, session, classNum]
        );
        
        let academicRecordId;
        if (academicRecords.length === 0) {
            const [result] = await connection.query(
                'INSERT INTO academic_records (student_id, session, class) VALUES (?, ?, ?)',
                [studentDbId, session, classNum]
            );
            academicRecordId = result.insertId;
        } else {
            academicRecordId = academicRecords[0].id;
        }
        
        // Check if marksheet already exists for this combination
        const [existing] = await connection.query(
            'SELECT id FROM marksheets WHERE student_id = ? AND session = ? AND class = ? AND exam_type = ?',
            [studentDbId, session, classNum, exam_type]
        );
        
        if (existing.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Marksheet already exists for this student, session, class, and exam type' 
            });
        }
        
        // Insert marksheet with Cloudinary details
        const cloudinaryData = {
            public_id: req.file.public_id || req.file.filename,
            secure_url: req.file.path || req.file.secure_url,
            original_filename: req.file.originalname,
            file_size: req.file.size
        };
        
        await connection.query(`
            INSERT INTO marksheets (
                student_id, academic_record_id, session, class, exam_type,
                cloudinary_public_id, cloudinary_url, original_filename, file_size,
                is_published
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            studentDbId, academicRecordId, session, classNum, exam_type,
            cloudinaryData.public_id, cloudinaryData.secure_url, 
            cloudinaryData.original_filename, cloudinaryData.file_size,
            false // unpublished by default
        ]);
        
        await connection.commit();
        
        res.status(201).json({
            success: true,
            message: 'Marksheet uploaded successfully',
            data: {
                cloudinary_url: cloudinaryData.secure_url,
                status: 'unpublished'
            }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error uploading marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to upload marksheet' });
    } finally {
        connection.release();
    }
});

// Get all marksheets
router.get('/marksheets', async (req, res) => {
    try {
        const { 
            student_id, session, class: classNum, exam_type, 
            is_published, page = 1, limit = 20 
        } = req.query;
        
        const offset = (page - 1) * limit;
        let query = `
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
            query += ' AND s.student_id LIKE ?';
            params.push(`%${student_id}%`);
        }
        if (session) {
            query += ' AND m.session = ?';
            params.push(session);
        }
        if (classNum) {
            query += ' AND m.class = ?';
            params.push(classNum);
        }
        if (exam_type) {
            query += ' AND m.exam_type LIKE ?';
            params.push(`%${exam_type}%`);
        }
        if (is_published !== undefined) {
            query += ' AND m.is_published = ?';
            params.push(is_published === 'true');
        }
        
        query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [marksheets] = await db.query(query, params);
        
        res.json({
            success: true,
            data: marksheets,
            pagination: { page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('Error fetching marksheets:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch marksheets' });
    }
});

// Get single marksheet
router.get('/marksheets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [marksheets] = await db.query(`
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
        console.error('Error fetching marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch marksheet' });
    }
});

// Replace marksheet
router.put('/marksheets/:id/replace', upload.single('pdf'), async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'PDF file is required' 
            });
        }
        
        // Get existing marksheet
        const [marksheets] = await connection.query(
            'SELECT cloudinary_public_id FROM marksheets WHERE id = ?',
            [id]
        );
        
        if (marksheets.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Marksheet not found' 
            });
        }
        
        // Delete old file from Cloudinary
        if (marksheets[0].cloudinary_public_id) {
            try {
                await cloudinary.uploader.destroy(marksheets[0].cloudinary_public_id, {
                    resource_type: 'raw'
                });
            } catch (err) {
                console.error('Failed to delete old Cloudinary file:', err);
            }
        }
        
        // Update with new Cloudinary details
        const cloudinaryData = {
            public_id: req.file.public_id || req.file.filename,
            secure_url: req.file.path || req.file.secure_url,
            original_filename: req.file.originalname,
            file_size: req.file.size
        };
        
        await connection.query(`
            UPDATE marksheets 
            SET cloudinary_public_id = ?, cloudinary_url = ?, 
                original_filename = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            cloudinaryData.public_id, cloudinaryData.secure_url,
            cloudinaryData.original_filename, cloudinaryData.file_size,
            id
        ]);
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Marksheet replaced successfully',
            data: { cloudinary_url: cloudinaryData.secure_url }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error replacing marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to replace marksheet' });
    } finally {
        connection.release();
    }
});

// Delete marksheet
router.delete('/marksheets/:id', async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        
        // Get marksheet
        const [marksheets] = await connection.query(
            'SELECT cloudinary_public_id FROM marksheets WHERE id = ?',
            [id]
        );
        
        if (marksheets.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Marksheet not found' 
            });
        }
        
        // Delete from Cloudinary
        if (marksheets[0].cloudinary_public_id) {
            try {
                await cloudinary.uploader.destroy(marksheets[0].cloudinary_public_id, {
                    resource_type: 'raw'
                });
            } catch (err) {
                console.error('Failed to delete Cloudinary file:', err);
            }
        }
        
        // Delete from database
        await connection.query('DELETE FROM marksheets WHERE id = ?', [id]);
        
        await connection.commit();
        
        res.json({
            success: true,
            message: 'Marksheet deleted successfully'
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to delete marksheet' });
    } finally {
        connection.release();
    }
});

// ============================================
// PUBLISH / UNPUBLISH
// ============================================

// Publish marksheet
router.post('/marksheets/:id/publish', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [result] = await db.query(
            'UPDATE marksheets SET is_published = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
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
            message: 'Marksheet published successfully'
        });
    } catch (error) {
        console.error('Error publishing marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to publish marksheet' });
    }
});

// Unpublish marksheet
router.post('/marksheets/:id/unpublish', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [result] = await db.query(
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
        console.error('Error unpublishing marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to unpublish marksheet' });
    }
});

// ============================================
// PUBLIC RESULT APIS
// ============================================

// Get available classes with published results
router.get('/public/classes', async (req, res) => {
    try {
        const [classes] = await db.query(`
            SELECT 
                class,
                COUNT(*) as total_published
            FROM marksheets
            WHERE is_published = TRUE
            GROUP BY class
            HAVING COUNT(*) > 0
            ORDER BY class
        `);
        
        res.json({
            success: true,
            data: classes
        });
    } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch classes' });
    }
});

// Get published results for a session and class
router.get('/public/:session/:class', async (req, res) => {
    try {
        const { session, class: classNum } = req.params;
        
        const [results] = await db.query(`
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
        console.error('Error fetching public results:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch results' });
    }
});

// Public student search (Student ID + DOB)
router.post('/public/search', async (req, res) => {
    try {
        const { student_id, dob } = req.body;
        
        if (!student_id || !dob) {
            return res.status(400).json({ 
                success: false, 
                message: 'Student ID and Date of Birth are required' 
            });
        }
        
        // Find student
        const [students] = await db.query(`
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
        
        // Get published marksheets
        const [marksheets] = await db.query(`
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
        console.error('Error searching public results:', error);
        res.status(500).json({ success: false, message: 'Failed to search results' });
    }
});

// View published marksheet
router.get('/public/marksheet/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [marksheets] = await db.query(`
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
        console.error('Error fetching marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch marksheet' });
    }
});

// Download marksheet
router.get('/public/marksheet/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [marksheets] = await db.query(`
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
        
        // Redirect to Cloudinary download URL
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
        console.error('Error downloading marksheet:', error);
        res.status(500).json({ success: false, message: 'Failed to download marksheet' });
    }
});

// ============================================
// ADMIN DASHBOARD STATISTICS
// ============================================

router.get('/dashboard/stats', async (req, res) => {
    try {
        // Overall stats
        const [overallStats] = await db.query(`
            SELECT 
                COUNT(DISTINCT student_id) as total_students,
                COUNT(*) as total_marksheets,
                SUM(CASE WHEN is_published = TRUE THEN 1 ELSE 0 END) as published_results,
                SUM(CASE WHEN is_published = FALSE THEN 1 ELSE 0 END) as unpublished_results
            FROM marksheets
        `);
        
        // Class-wise stats
        const [classStats] = await db.query(`
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
                overall: overallStats[0] || { total_students: 0, total_marksheets: 0, published_results: 0, unpublished_results: 0 },
                class_wise: classStats
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
    }
});

module.exports = { db: pool.promise() };

