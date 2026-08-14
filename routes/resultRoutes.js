const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');
require('dotenv').config();

// =============================================
// CLOUDINARY CONFIGURATION
// =============================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// =============================================
// DATABASE CONNECTION
// =============================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'school_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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
            return `${studentId}_${studentClass}_${session}_${Date.now()}`;
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

// Get Cloudinary public ID from URL
const getPublicIdFromUrl = (url) => {
    if (!url) return null;
    try {
        const parts = url.split('/');
        const filename = parts[parts.length - 1];
        return filename.split('.')[0];
    } catch (error) {
        return null;
    }
};

// Delete from Cloudinary
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

// =============================================
// 1. STUDENT ROUTES
// =============================================

// Add Student
router.post('/students', async (req, res) => {
    try {
        const { studentId, studentName, fatherName, apaarId, dob, class: studentClass, session } = req.body;

        // Validation
        if (!studentId || !studentName || !fatherName || !apaarId || !dob || !studentClass || !session) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        const [result] = await pool.execute(
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

// Get All Students with Filters
router.get('/students', async (req, res) => {
    try {
        const { class: studentClass, session } = req.query;
        let query = 'SELECT * FROM students';
        let params = [];

        if (studentClass && session) {
            query += ' WHERE class = ? AND session_year = ? ORDER BY student_name';
            params = [studentClass, session];
        } else if (studentClass) {
            query += ' WHERE class = ? ORDER BY student_name';
            params = [studentClass];
        } else if (session) {
            query += ' WHERE session_year = ? ORDER BY student_name';
            params = [session];
        } else {
            query += ' ORDER BY session_year DESC, class ASC, student_name';
        }

        const [students] = await pool.execute(query, params);
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
        const [students] = await pool.execute(
            'SELECT * FROM students WHERE student_id = ?',
            [studentId]
        );

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

        const [result] = await pool.execute(
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

        // First get all results for this student
        const [results] = await pool.execute(
            'SELECT marksheet_file, marksheet_public_id FROM results WHERE student_id = ?',
            [studentId]
        );

        // Delete files from Cloudinary
        for (const result of results) {
            if (result.marksheet_public_id) {
                await deleteFromCloudinary(result.marksheet_public_id);
            }
        }

        // Delete from database (cascade will delete results)
        const [result] = await pool.execute(
            'DELETE FROM students WHERE student_id = ?',
            [studentId]
        );

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

// Upload Single Result (with Cloudinary)
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
        const [students] = await pool.execute(
            'SELECT * FROM students WHERE student_id = ?',
            [studentId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found. Please add student first.'
            });
        }

        // Get Cloudinary file URL and public ID
        const fileUrl = req.file.path;
        const publicId = req.file.filename;

        // Check if result already exists
        const [existing] = await pool.execute(
            'SELECT * FROM results WHERE student_id = ? AND class = ? AND session_year = ?',
            [studentId, studentClass, session]
        );

        if (existing.length > 0) {
            // Delete old file from Cloudinary
            if (existing[0].marksheet_public_id) {
                await deleteFromCloudinary(existing[0].marksheet_public_id);
            }

            // Update existing result
            await pool.execute(
                `UPDATE results 
                SET marksheet_file = ?, marksheet_public_id = ?, 
                    status = 'unpublished', updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?`,
                [fileUrl, publicId, existing[0].id]
            );

            res.json({
                success: true,
                message: 'Result updated successfully',
                data: {
                    fileUrl,
                    publicId
                }
            });
        } else {
            // Insert new result
            await pool.execute(
                `INSERT INTO results 
                (student_id, class, session_year, marksheet_file, marksheet_public_id, status) 
                VALUES (?, ?, ?, ?, ?, 'unpublished')`,
                [studentId, studentClass, session, fileUrl, publicId]
            );

            res.status(201).json({
                success: true,
                message: 'Result uploaded successfully',
                data: {
                    fileUrl,
                    publicId
                }
            });
        }
    } catch (error) {
        console.error('Upload result error:', error);
        // Delete from Cloudinary if error occurs
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
                // Check if student exists
                const [students] = await pool.execute(
                    'SELECT * FROM students WHERE student_id = ?',
                    [studentId]
                );

                if (students.length === 0) {
                    errors.push({ studentId, error: 'Student not found' });
                    await deleteFromCloudinary(file.filename);
                    continue;
                }

                // Check if result exists
                const [existing] = await pool.execute(
                    'SELECT * FROM results WHERE student_id = ? AND class = ? AND session_year = ?',
                    [studentId, studentClass, session]
                );

                if (existing.length > 0) {
                    // Delete old file
                    if (existing[0].marksheet_public_id) {
                        await deleteFromCloudinary(existing[0].marksheet_public_id);
                    }

                    // Update
                    await pool.execute(
                        `UPDATE results 
                        SET marksheet_file = ?, marksheet_public_id = ?, 
                            status = 'unpublished', updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?`,
                        [file.path, file.filename, existing[0].id]
                    );
                    results.push({ studentId, status: 'updated' });
                } else {
                    // Insert
                    await pool.execute(
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
        let query = `
            SELECT 
                r.*,
                s.student_name,
                s.father_name,
                s.apaar_id,
                s.date_of_birth
            FROM results r
            JOIN students s ON r.student_id = s.student_id
            WHERE 1=1
        `;
        let params = [];

        if (studentClass) {
            query += ' AND r.class = ?';
            params.push(studentClass);
        }
        if (session) {
            query += ' AND r.session_year = ?';
            params.push(session);
        }
        if (status) {
            query += ' AND r.status = ?';
            params.push(status);
        }

        query += ' ORDER BY r.session_year DESC, r.class ASC, s.student_name';

        const [results] = await pool.execute(query, params);
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
        const [results] = await pool.execute(
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
        
        let query = `
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
            query += ' AND r.class = ?';
            params.push(studentClass);
        }
        if (session) {
            query += ' AND r.session_year = ?';
            params.push(session);
        }

        const [results] = await pool.execute(query, params);

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
        
        const [result] = await pool.execute(
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
        
        const [result] = await pool.execute(
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

        const [result] = await pool.execute(
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

        const [result] = await pool.execute(
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

        // Get file public ID
        const [results] = await pool.execute(
            'SELECT marksheet_public_id FROM results WHERE id = ?',
            [resultId]
        );

        if (results.length > 0 && results[0].marksheet_public_id) {
            // Delete from Cloudinary
            await deleteFromCloudinary(results[0].marksheet_public_id);
        }

        const [result] = await pool.execute(
            'DELETE FROM results WHERE id = ?',
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

        // Get all file public IDs
        const [results] = await pool.execute(
            'SELECT marksheet_public_id FROM results WHERE class = ? AND session_year = ?',
            [studentClass, session]
        );

        // Delete all files from Cloudinary
        for (const result of results) {
            if (result.marksheet_public_id) {
                await deleteFromCloudinary(result.marksheet_public_id);
            }
        }

        // Delete from database
        const [result] = await pool.execute(
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
        const [classes] = await pool.execute(
            `SELECT DISTINCT 
                class, 
                session_year,
                COUNT(*) as total_students
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

// Verify Student and Get Result (Public)
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

        let query = `
            SELECT 
                s.student_id,
                s.student_name,
                s.father_name,
                s.apaar_id,
                s.date_of_birth,
                r.class,
                r.session_year,
                r.marksheet_file,
                r.status,
                r.published_date
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
            query += ' AND s.student_id = ?';
            params.push(studentId);
        } else if (apaarId) {
            query += ' AND s.apaar_id = ?';
            params.push(apaarId);
        }

        const [students] = await pool.execute(query, params);

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
                publishedDate: student.published_date
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
        const [totalStudents] = await pool.execute(
            'SELECT COUNT(*) as count FROM students'
        );
        
        const [publishedResults] = await pool.execute(
            'SELECT COUNT(*) as count FROM results WHERE status = "published"'
        );
        
        const [unpublishedResults] = await pool.execute(
            'SELECT COUNT(*) as count FROM results WHERE status = "unpublished"'
        );

        const [classes] = await pool.execute(
            'SELECT DISTINCT class, session_year FROM students ORDER BY session_year DESC, class ASC'
        );

        res.json({
            success: true,
            data: {
                totalStudents: totalStudents[0].count,
                publishedResults: publishedResults[0].count,
                unpublishedResults: unpublishedResults[0].count,
                totalResults: publishedResults[0].count + unpublishedResults[0].count,
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
