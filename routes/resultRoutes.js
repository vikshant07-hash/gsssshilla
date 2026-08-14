const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { v2: cloudinary } = require('cloudinary');
const { db } = require('../config/db');
const path = require('path');
require('dotenv').config();

// =============================================
// CLOUDINARY STORAGE CONFIGURATION
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

// Delete file from Cloudinary
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

// Execute query with promise
const query = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

// =============================================
// 1. STUDENT ROUTES
// =============================================

// Add Student
router.post('/students', async (req, res) => {
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

// Get All Students
router.get('/students', async (req, res) => {
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

// Get Single Student
router.get('/students/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const students = await query('SELECT * FROM students WHERE student_id = ?', [studentId]);

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        res.json({
            success: true,
            data: students[0]
        });
    } catch (error) {
        console.error('Get student error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Update Student
router.put('/students/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const { studentName, fatherName, apaarId, dob, class: studentClass, session } = req.body;

        const result = await query(
            `UPDATE students 
            SET student_name = ?, father_name = ?, apaar_id = ?, 
                date_of_birth = ?, class = ?, session_year = ?
            WHERE student_id = ?`,
            [studentName, fatherName, apaarId, dob, studentClass, session, studentId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        res.json({
            success: true,
            message: 'Student updated successfully'
        });
    } catch (error) {
        console.error('Update student error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Delete Student
router.delete('/students/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;

        // Get all results for this student
        const results = await query(
            'SELECT marksheet_public_id FROM results WHERE student_id = ?',
            [studentId]
        );

        // Delete files from Cloudinary
        for (const result of results) {
            if (result.marksheet_public_id) {
                await deleteFromCloudinary(result.marksheet_public_id);
            }
        }

        const result = await query('DELETE FROM students WHERE student_id = ?', [studentId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        res.json({
            success: true,
            message: 'Student and all related results deleted successfully'
        });
    } catch (error) {
        console.error('Delete student error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// =============================================
// 2. RESULT ROUTES
// =============================================

// Upload Single Result
router.post('/results/upload', upload.single('marksheet'), async (req, res) => {
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

        // Check if student exists
        const students = await query('SELECT * FROM students WHERE student_id = ?', [studentId]);

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found. Please add student first.'
            });
        }

        const fileUrl = req.file.path;
        const publicId = req.file.filename;

        // Check if result already exists
        const existing = await query(
            'SELECT * FROM results WHERE student_id = ? AND class = ? AND session_year = ?',
            [studentId, studentClass, session]
        );

        if (existing.length > 0) {
            // Delete old file from Cloudinary
            if (existing[0].marksheet_public_id) {
                await deleteFromCloudinary(existing[0].marksheet_public_id);
            }

            // Update existing result
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
            // Insert new result
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

// Bulk Upload Results
router.post('/results/bulk-upload', upload.array('marksheets', 50), async (req, res) => {
    try {
        const results = [];
        const errors = [];

        for (const file of req.files) {
            const { studentId, class: studentClass, session } = req.body;
            
            try {
                const students = await query('SELECT * FROM students WHERE student_id = ?', [studentId]);

                if (students.length === 0) {
                    errors.push({ studentId, error: 'Student not found' });
                    await deleteFromCloudinary(file.filename);
                    continue;
                }

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
                        [file.path, file.filename, existing[0].id]
                    );
                    results.push({ studentId, status: 'updated' });
                } else {
                    await query(
                        `INSERT INTO results 
                        (student_id, class, session_year, marksheet_file, marksheet_public_id, status) 
                        VALUES (?, ?, ?, ?, ?, 'unpublished')`,
                        [studentId, studentClass, session, file.path, file.filename]
                    );
                    results.push({ studentId, status: 'uploaded' });
                }
            } catch (error) {
                errors.push({ studentId, error: error.message });
                await deleteFromCloudinary(file.filename);
            }
        }

        res.json({
            success: true,
            message: 'Bulk upload completed',
            data: { results, errors }
        });
    } catch (error) {
        console.error('Bulk upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Get All Results
router.get('/results', async (req, res) => {
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

// Get Single Result
router.get('/results/:resultId', async (req, res) => {
    try {
        const { resultId } = req.params;
        const results = await query(
            `SELECT 
                r.*,
                s.student_name,
                s.father_name,
                s.apaar_id,
                s.date_of_birth
            FROM results r
            JOIN students s ON r.student_id = s.student_id
            WHERE r.id = ?`,
            [resultId]
        );

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    } catch (error) {
        console.error('Get result error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Get Student Result by Student ID
router.get('/results/student/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const { class: studentClass, session } = req.query;
        
        let sql = `
            SELECT 
                r.*,
                s.student_name,
                s.father_name,
                s.apaar_id,
                s.date_of_birth
            FROM results r
            JOIN students s ON r.student_id = s.student_id
            WHERE r.student_id = ?
        `;
        let params = [studentId];

        if (studentClass) {
            sql += ' AND r.class = ?';
            params.push(studentClass);
        }
        if (session) {
            sql += ' AND r.session_year = ?';
            params.push(session);
        }

        const results = await query(sql, params);

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No results found for this student'
            });
        }

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Get student result error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// =============================================
// 3. RESULT STATUS MANAGEMENT
// =============================================

// Publish Single Result
router.put('/results/:resultId/publish', async (req, res) => {
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

// Unpublish Single Result
router.put('/results/:resultId/unpublish', async (req, res) => {
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

// Publish All Results for a Class
router.put('/results/publish-all', async (req, res) => {
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

// Unpublish All Results for a Class
router.put('/results/unpublish-all', async (req, res) => {
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

// Delete Single Result
router.delete('/results/:resultId', async (req, res) => {
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

// Delete All Results for a Class
router.delete('/results/delete-all', async (req, res) => {
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

// =============================================
// 4. PUBLIC ROUTES (For Students)
// =============================================

// Get Available Classes with Published Results
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

// Verify Student and Get Result
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
// 5. DASHBOARD STATS
// =============================================

router.get('/stats', async (req, res) => {
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

// =============================================
// 6. GET PUBLISHED STATUS FOR A CLASS
// =============================================

router.get('/status/:class/:session', async (req, res) => {
    try {
        const { class: studentClass, session } = req.params;
        const results = await query(
            'SELECT COUNT(*) as total, SUM(CASE WHEN status = "published" THEN 1 ELSE 0 END) as published FROM results WHERE class = ? AND session_year = ?',
            [studentClass, session]
        );

        res.json({
            success: true,
            data: {
                class: studentClass,
                session: session,
                total: results[0]?.total || 0,
                published: results[0]?.published || 0,
                isPublished: results[0]?.total === results[0]?.published && results[0]?.total > 0
            }
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

module.exports = router;
