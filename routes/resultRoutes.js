const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { v2: cloudinary } = require('cloudinary');
const { db } = require('../config/db');
require('dotenv').config();

// =============================================
// CLOUDINARY STORAGE
// =============================================
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'school_results',
        resource_type: 'raw',
        public_id: (req, file) => {
            const { studentId, class: studentClass, session } = req.body;
            return `result_${studentId}_${studentClass}_${session}_${Date.now()}`;
        },
        format: 'pdf',
        access_mode: 'public'
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

// =============================================
// HELPER FUNCTIONS
// =============================================
const deleteFromCloudinary = async (publicId) => {
    try {
        if (publicId) {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
            return true;
        }
        return false;
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        return false;
    }
};

const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

// =============================================
// AUTH MIDDLEWARE
// =============================================
const adminAuth = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token && !req.session?.admin_id) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized. Please login.'
        });
    }
    next();
};

// =============================================
// =============================================
// 🟢 PUBLIC ROUTES (NO AUTH)
// =============================================
// =============================================

// ✅ GET: /api/result/public/classes
router.get('/public/classes', async (req, res) => {
    try {
        const classes = await query(
            `SELECT DISTINCT 
                class, 
                session_year,
                COUNT(*) as total_students,
                DATE_FORMAT(CONVERT_TZ(MAX(published_date), '+00:00', '+05:30'), '%d/%m/%y') as published_date_ist
            FROM results 
            WHERE status = 'published' 
            GROUP BY class, session_year 
            ORDER BY session_year DESC, class ASC`
        );

        res.json({
            success: true,
            data: classes
        });
    } catch (error) {
        console.error('Get public classes error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ POST: /api/result/public/verify
router.post('/public/verify', async (req, res) => {
    try {
        const { studentId, apaarId, dob, class: studentClass, session } = req.body;

        if (!dob || !studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'Date of Birth, Class, and Session are required'
            });
        }

        if (!studentId && !apaarId) {
            return res.status(400).json({
                success: false,
                message: 'Either Student ID or APAAR ID is required'
            });
        }

        let sql = `
            SELECT 
                s.student_id,
                s.student_name,
                s.father_name,
                s.apaar_id,
                DATE_FORMAT(s.date_of_birth, '%Y-%m-%d') as date_of_birth,
                r.class,
                r.session_year,
                r.marksheet_file,
                r.status,
                DATE_FORMAT(CONVERT_TZ(r.published_date, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as published_date_ist
            FROM students s
            JOIN results r ON s.student_id = r.student_id
            WHERE s.date_of_birth = ? 
            AND s.class = ? 
            AND s.session_year = ?
            AND r.class = ?
            AND r.session_year = ?
            AND r.status = 'published'
        `;
        let params = [dob, studentClass, session, studentClass, session];

        if (studentId) {
            sql += ' AND s.student_id = ?';
            params.push(studentId);
        } else if (apaarId) {
            sql += ' AND s.apaar_id = ?';
            params.push(apaarId);
        }

        const students = await query(sql, params);

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No result found. Please check your details or result may not be published yet.'
            });
        }

        const student = students[0];

        res.json({
            success: true,
            data: {
                studentId: student.student_id,
                studentName: student.student_name,
                fatherName: student.father_name,
                apaarId: student.apaar_id,
                dateOfBirth: student.date_of_birth,
                class: student.class,
                session: student.session_year,
                resultFile: student.marksheet_file,
                status: student.status,
                publishedDate: student.published_date_ist
            }
        });
    } catch (error) {
        console.error('Verify student error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// =============================================
// =============================================
// 🔴 ADMIN ROUTES (AUTH REQUIRED)
// =============================================
// =============================================

// ✅ POST: /api/result/admin/students
router.post('/admin/students', adminAuth, async (req, res) => {
    try {
        const { studentId, studentName, fatherName, apaarId, dob, class: studentClass, session } = req.body;

        if (!studentId || !studentName || !fatherName || !apaarId || !dob || !studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        await query(
            `INSERT INTO students 
            (student_id, student_name, father_name, apaar_id, date_of_birth, class, session_year) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [studentId, studentName, fatherName, apaarId, dob, studentClass, session]
        );

        res.status(201).json({
            success: true,
            message: 'Student added successfully',
            data: { studentId }
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({
                success: false,
                message: 'Student ID or APAAR ID already exists'
            });
        } else {
            console.error('Add student error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
                error: error.message
            });
        }
    }
});

// ✅ GET: /api/result/admin/students
router.get('/admin/students', adminAuth, async (req, res) => {
    try {
        const { class: studentClass, session } = req.query;
        let sql = 'SELECT * FROM students';
        let params = [];

        if (studentClass && session) {
            sql += ' WHERE class = ? AND session_year = ? ORDER BY student_name';
            params = [studentClass, session];
        } else if (studentClass) {
            sql += ' WHERE class = ? ORDER BY student_name';
            params = [studentClass];
        } else if (session) {
            sql += ' WHERE session_year = ? ORDER BY student_name';
            params = [session];
        } else {
            sql += ' ORDER BY session_year DESC, class ASC, student_name';
        }

        const students = await query(sql, params);
        res.json({
            success: true,
            data: students
        });
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ POST: /api/result/admin/results/upload
router.post('/admin/results/upload', adminAuth, upload.single('marksheet'), async (req, res) => {
    try {
        const { studentId, class: studentClass, session } = req.body;

        if (!studentId || !studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'Student ID, Class, and Session are required'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'PDF file is required'
            });
        }

        const students = await query('SELECT * FROM students WHERE student_id = ?', [studentId]);

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found. Please add student first.'
            });
        }

        const fileUrl = req.file.path;
        const publicId = req.file.filename;

        const existing = await query(
            'SELECT * FROM results WHERE student_id = ? AND class = ? AND session_year = ?',
            [studentId, studentClass, session]
        );

        if (existing.length > 0) {
            if (existing[0].marksheet_public_id) {
                await deleteFromCloudinary(existing[0].marksheet_public_id);
            }

            await query(
                `UPDATE results 
                SET marksheet_file = ?, marksheet_public_id = ?, 
                    status = 'unpublished', updated_at = NOW() 
                WHERE id = ?`,
                [fileUrl, publicId, existing[0].id]
            );

            res.json({
                success: true,
                message: 'Result updated successfully',
                data: { fileUrl, publicId }
            });
        } else {
            await query(
                `INSERT INTO results 
                (student_id, class, session_year, marksheet_file, marksheet_public_id, status) 
                VALUES (?, ?, ?, ?, ?, 'unpublished')`,
                [studentId, studentClass, session, fileUrl, publicId]
            );

            res.status(201).json({
                success: true,
                message: 'Result uploaded successfully',
                data: { fileUrl, publicId }
            });
        }
    } catch (error) {
        console.error('Upload result error:', error);
        if (req.file && req.file.filename) {
            await deleteFromCloudinary(req.file.filename);
        }
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ GET: /api/result/admin/results
router.get('/admin/results', adminAuth, async (req, res) => {
    try {
        const { class: studentClass, session, status } = req.query;
        let sql = `
            SELECT 
                r.*,
                s.student_name,
                s.father_name,
                s.apaar_id,
                s.date_of_birth,
                DATE_FORMAT(CONVERT_TZ(r.created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
                DATE_FORMAT(CONVERT_TZ(r.published_date, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as published_date_ist
            FROM results r
            JOIN students s ON r.student_id = s.student_id
            WHERE 1=1
        `;
        let params = [];

        if (studentClass) {
            sql += ' AND r.class = ?';
            params.push(studentClass);
        }
        if (session) {
            sql += ' AND r.session_year = ?';
            params.push(session);
        }
        if (status) {
            sql += ' AND r.status = ?';
            params.push(status);
        }

        sql += ' ORDER BY r.session_year DESC, r.class ASC, s.student_name';

        const results = await query(sql, params);
        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Get results error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ PUT: /api/result/admin/results/:resultId/publish
router.put('/admin/results/:resultId/publish', adminAuth, async (req, res) => {
    try {
        const { resultId } = req.params;
        
        const result = await query(
            'UPDATE results SET status = "published", published_date = NOW() WHERE id = ?',
            [resultId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }

        res.json({
            success: true,
            message: 'Result published successfully'
        });
    } catch (error) {
        console.error('Publish result error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ PUT: /api/result/admin/results/:resultId/unpublish
router.put('/admin/results/:resultId/unpublish', adminAuth, async (req, res) => {
    try {
        const { resultId } = req.params;
        
        const result = await query(
            'UPDATE results SET status = "unpublished", published_date = NULL WHERE id = ?',
            [resultId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }

        res.json({
            success: true,
            message: 'Result unpublished successfully'
        });
    } catch (error) {
        console.error('Unpublish result error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ PUT: /api/result/admin/results/publish-all
router.put('/admin/results/publish-all', adminAuth, async (req, res) => {
    try {
        const { class: studentClass, session } = req.body;

        if (!studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'Class and Session are required'
            });
        }

        const result = await query(
            'UPDATE results SET status = "published", published_date = NOW() WHERE class = ? AND session_year = ?',
            [studentClass, session]
        );

        res.json({
            success: true,
            message: `${result.affectedRows} results published successfully`
        });
    } catch (error) {
        console.error('Publish all results error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ PUT: /api/result/admin/results/unpublish-all
router.put('/admin/results/unpublish-all', adminAuth, async (req, res) => {
    try {
        const { class: studentClass, session } = req.body;

        if (!studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'Class and Session are required'
            });
        }

        const result = await query(
            'UPDATE results SET status = "unpublished", published_date = NULL WHERE class = ? AND session_year = ?',
            [studentClass, session]
        );

        res.json({
            success: true,
            message: `${result.affectedRows} results unpublished successfully`
        });
    } catch (error) {
        console.error('Unpublish all results error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ DELETE: /api/result/admin/results/:resultId
router.delete('/admin/results/:resultId', adminAuth, async (req, res) => {
    try {
        const { resultId } = req.params;

        const results = await query(
            'SELECT marksheet_public_id FROM results WHERE id = ?',
            [resultId]
        );

        if (results.length > 0 && results[0].marksheet_public_id) {
            await deleteFromCloudinary(results[0].marksheet_public_id);
        }

        const result = await query('DELETE FROM results WHERE id = ?', [resultId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }

        res.json({
            success: true,
            message: 'Result deleted successfully'
        });
    } catch (error) {
        console.error('Delete result error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ DELETE: /api/result/admin/results/delete-all
router.delete('/admin/results/delete-all', adminAuth, async (req, res) => {
    try {
        const { class: studentClass, session } = req.body;

        if (!studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'Class and Session are required'
            });
        }

        const results = await query(
            'SELECT marksheet_public_id FROM results WHERE class = ? AND session_year = ?',
            [studentClass, session]
        );

        for (const result of results) {
            if (result.marksheet_public_id) {
                await deleteFromCloudinary(result.marksheet_public_id);
            }
        }

        const result = await query(
            'DELETE FROM results WHERE class = ? AND session_year = ?',
            [studentClass, session]
        );

        res.json({
            success: true,
            message: `${result.affectedRows} results deleted successfully`
        });
    } catch (error) {
        console.error('Delete all results error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ✅ GET: /api/result/admin/stats
router.get('/admin/stats', adminAuth, async (req, res) => {
    try {
        const [totalStudents] = await query('SELECT COUNT(*) as count FROM students');
        const [publishedResults] = await query('SELECT COUNT(*) as count FROM results WHERE status = "published"');
        const [unpublishedResults] = await query('SELECT COUNT(*) as count FROM results WHERE status = "unpublished"');
        const classes = await query('SELECT DISTINCT class, session_year FROM students ORDER BY session_year DESC, class ASC');

        res.json({
            success: true,
            data: {
                totalStudents: totalStudents.count,
                publishedResults: publishedResults.count,
                unpublishedResults: unpublishedResults.count,
                totalResults: publishedResults.count + unpublishedResults.count,
                classes: classes
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

module.exports = router;
