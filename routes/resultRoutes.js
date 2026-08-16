const express = require('express');
const router = express.Router();
const { db } = require('../config/db');
const cloudinary = require('cloudinary').v2;

// Cloudinary config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============================================================
// STUDENT ROUTES - Without Photo
// ============================================================

// GET all students (with class filter)
router.get('/students', (req, res) => {
    const { class: classFilter } = req.query;
    let query = 'SELECT * FROM students';
    let params = [];
    if (classFilter) {
        query += ' WHERE class = ?';
        params.push(classFilter);
    }
    query += ' ORDER BY student_name ASC';
    db.query(query, params, (err, results) => {
        if (err) {
            console.error('❌ Error fetching students:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, data: results || [] });
    });
});

// GET students by class with result status
router.get('/students/class/:class', (req, res) => {
    const { class: className } = req.params;
    const query = `
        SELECT s.*, 
               r.id as result_id, 
               r.marksheet_url, 
               r.is_published,
               r.uploaded_at,
               r.published_at,
               CASE 
                   WHEN r.id IS NOT NULL AND r.is_published = 1 THEN 'published'
                   WHEN r.id IS NOT NULL THEN 'uploaded'
                   ELSE 'pending'
               END as result_status_display
        FROM students s
        LEFT JOIN results r ON s.id = r.student_id
        WHERE s.class = ?
        ORDER BY s.student_name ASC
    `;
    db.query(query, [className], (err, results) => {
        if (err) {
            console.error('❌ Error fetching class students:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, data: results || [] });
    });
});

// GET single student
router.get('/students/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM students WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error fetching student:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        res.json({ success: true, data: results[0] });
    });
});

// POST create student (Without Photo)
router.post('/students', (req, res) => {
    const {
        studentName, fatherName, motherName, studentId, apaarId,
        class: className, aaharNumber, examRollNo, dateOfBirth,
        session, examType, stream
    } = req.body;

    if (!studentName || !fatherName || !motherName || !studentId || !apaarId ||
        !className || !aaharNumber || !examRollNo || !dateOfBirth ||
        !session || !examType) {
        return res.status(400).json({ 
            success: false, 
            message: 'All fields are required' 
        });
    }

    db.query('SELECT id FROM students WHERE student_id = ?', [studentId], (err, results) => {
        if (err) {
            console.error('❌ Error checking duplicate:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (results && results.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Student ID already exists' 
            });
        }

        const query = `
            INSERT INTO students (
                student_name, father_name, mother_name, student_id, apaar_id,
                class, aahar_number, exam_roll_no, date_of_birth,
                session, exam_type, stream, result_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `;
        db.query(query, [
            studentName, fatherName, motherName, studentId, apaarId,
            className, aaharNumber, examRollNo, dateOfBirth,
            session, examType, stream || ''
        ], (insertErr, result) => {
            if (insertErr) {
                console.error('❌ Error inserting student:', insertErr);
                return res.status(500).json({ success: false, message: insertErr.message });
            }
            db.query('SELECT * FROM students WHERE id = ?', [result.insertId], (fetchErr, newStudent) => {
                if (fetchErr) {
                    console.error('❌ Error fetching new student:', fetchErr);
                    return res.status(500).json({ success: false, message: fetchErr.message });
                }
                res.status(201).json({ 
                    success: true, 
                    data: newStudent[0],
                    message: 'Student added successfully' 
                });
            });
        });
    });
});

// PUT update student (Without Photo)
router.put('/students/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    db.query('SELECT * FROM students WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error checking student:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        const allowedFields = [
            'student_name', 'father_name', 'mother_name', 'student_id',
            'apaar_id', 'class', 'aahar_number', 'exam_roll_no',
            'date_of_birth', 'session', 'exam_type', 'stream'
        ];
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key) && value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        if (fields.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No valid fields to update' 
            });
        }
        values.push(id);
        const query = `UPDATE students SET ${fields.join(', ')} WHERE id = ?`;
        db.query(query, values, (updateErr) => {
            if (updateErr) {
                console.error('❌ Error updating student:', updateErr);
                return res.status(500).json({ success: false, message: updateErr.message });
            }
            db.query('SELECT * FROM students WHERE id = ?', [id], (fetchErr, updated) => {
                if (fetchErr) {
                    console.error('❌ Error fetching updated student:', fetchErr);
                    return res.status(500).json({ success: false, message: fetchErr.message });
                }
                res.json({ 
                    success: true, 
                    data: updated[0],
                    message: 'Student updated successfully' 
                });
            });
        });
    });
});

// DELETE student
router.delete('/students/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM students WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error checking student:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        db.query('DELETE FROM students WHERE id = ?', [id], (deleteErr) => {
            if (deleteErr) {
                console.error('❌ Error deleting student:', deleteErr);
                return res.status(500).json({ success: false, message: deleteErr.message });
            }
            res.json({ success: true, message: 'Student deleted successfully' });
        });
    });
});

// ============================================================
// RESULT ROUTES
// ============================================================

// Upload marksheet (PDF)
router.post('/upload', async (req, res) => {
    try {
        const { studentId } = req.body;
        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Student ID is required' });
        }
        if (!req.files || !req.files.marksheet) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const file = req.files.marksheet;
        if (file.mimetype !== 'application/pdf') {
            return res.status(400).json({ success: false, message: 'Only PDF files are allowed' });
        }
        db.query('SELECT * FROM students WHERE id = ?', [studentId], async (err, studentResults) => {
            if (err) {
                console.error('❌ Error checking student:', err);
                return res.status(500).json({ success: false, message: err.message });
            }
            if (!studentResults || studentResults.length === 0) {
                return res.status(404).json({ success: false, message: 'Student not found' });
            }
            try {
                const result = await cloudinary.uploader.upload(file.tempFilePath, {
                    folder: 'results',
                    resource_type: 'auto',
                    allowed_formats: ['pdf']
                });
                db.query('SELECT id FROM results WHERE student_id = ?', [studentId], (err2, existingResult) => {
                    if (err2) {
                        console.error('❌ Error checking existing result:', err2);
                        return res.status(500).json({ success: false, message: err2.message });
                    }
                    if (existingResult && existingResult.length > 0) {
                        db.query(
                            `UPDATE results SET 
                             marksheet_url = ?, 
                             public_id = ?, 
                             uploaded_at = CURRENT_TIMESTAMP, 
                             is_published = false,
                             published_at = NULL
                             WHERE student_id = ?`,
                            [result.secure_url, result.public_id, studentId],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('❌ Error updating result:', updateErr);
                                    return res.status(500).json({ success: false, message: updateErr.message });
                                }
                                db.query('UPDATE students SET result_status = "uploaded" WHERE id = ?', [studentId]);
                                db.query('SELECT * FROM results WHERE student_id = ?', [studentId], (fetchErr, updated) => {
                                    if (fetchErr) {
                                        console.error('❌ Error fetching updated result:', fetchErr);
                                        return res.status(500).json({ success: false, message: fetchErr.message });
                                    }
                                    res.json({ 
                                        success: true, 
                                        data: updated[0],
                                        message: 'Marksheet updated successfully' 
                                    });
                                });
                            }
                        );
                    } else {
                        db.query(
                            `INSERT INTO results (student_id, marksheet_url, public_id) 
                             VALUES (?, ?, ?)`,
                            [studentId, result.secure_url, result.public_id],
                            (insertErr, insertResult) => {
                                if (insertErr) {
                                    console.error('❌ Error inserting result:', insertErr);
                                    return res.status(500).json({ success: false, message: insertErr.message });
                                }
                                db.query('UPDATE students SET result_status = "uploaded" WHERE id = ?', [studentId]);
                                db.query('SELECT * FROM results WHERE id = ?', [insertResult.insertId], (fetchErr, newResult) => {
                                    if (fetchErr) {
                                        console.error('❌ Error fetching new result:', fetchErr);
                                        return res.status(500).json({ success: false, message: fetchErr.message });
                                    }
                                    res.status(201).json({ 
                                        success: true, 
                                        data: newResult[0],
                                        message: 'Marksheet uploaded successfully' 
                                    });
                                });
                            }
                        );
                    }
                });
            } catch (cloudinaryErr) {
                console.error('❌ Cloudinary upload error:', cloudinaryErr);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to upload to Cloudinary: ' + cloudinaryErr.message 
                });
            }
        });
    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get result status
router.get('/status/:studentId', (req, res) => {
    const { studentId } = req.params;
    const query = `
        SELECT s.result_status, 
               r.id as result_id,
               r.marksheet_url, 
               r.is_published, 
               r.uploaded_at,
               r.published_at
        FROM students s 
        LEFT JOIN results r ON s.id = r.student_id 
        WHERE s.id = ?
    `;
    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('❌ Error fetching status:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        res.json({ success: true, data: results[0] });
    });
});

// Get all results for a class
router.get('/class/:class', (req, res) => {
    const { class: className } = req.params;
    const query = `
        SELECT s.*, 
               r.id as result_id,
               r.marksheet_url, 
               r.is_published, 
               r.uploaded_at, 
               r.published_at,
               CASE 
                   WHEN r.id IS NOT NULL AND r.is_published = 1 THEN 'published'
                   WHEN r.id IS NOT NULL THEN 'uploaded'
                   ELSE 'pending'
               END as result_status_display
        FROM students s 
        LEFT JOIN results r ON s.id = r.student_id 
        WHERE s.class = ?
        ORDER BY s.student_name ASC
    `;
    db.query(query, [className], (err, results) => {
        if (err) {
            console.error('❌ Error fetching class results:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, data: results || [] });
    });
});

// Publish results for a class
router.post('/publish', (req, res) => {
    const { class: className } = req.body;
    if (!className) {
        return res.status(400).json({ success: false, message: 'Class is required' });
    }
    db.query(
        `SELECT s.id, r.id as result_id 
         FROM students s 
         INNER JOIN results r ON s.id = r.student_id 
         WHERE s.class = ? AND s.result_status = 'uploaded'`,
        [className],
        (err, students) => {
            if (err) {
                console.error('❌ Error fetching students:', err);
                return res.status(500).json({ success: false, message: err.message });
            }
            if (!students || students.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'No uploaded results found for this class' 
                });
            }
            const resultIds = students.map(s => s.result_id);
            const placeholders = resultIds.map(() => '?').join(',');
            db.query(
                `UPDATE results SET is_published = true, published_at = CURRENT_TIMESTAMP 
                 WHERE id IN (${placeholders})`,
                resultIds,
                (updateErr) => {
                    if (updateErr) {
                        console.error('❌ Error publishing results:', updateErr);
                        return res.status(500).json({ success: false, message: updateErr.message });
                    }
                    const studentIds = students.map(s => s.id);
                    const studentPlaceholders = studentIds.map(() => '?').join(',');
                    db.query(
                        `UPDATE students SET result_status = 'published' 
                         WHERE id IN (${studentPlaceholders})`,
                        studentIds,
                        (statusErr) => {
                            if (statusErr) console.error('⚠️ Status update error:', statusErr);
                            res.json({ 
                                success: true, 
                                message: `Results published for ${students.length} students in class ${className}` 
                            });
                        }
                    );
                }
            );
        }
    );
});

// Unpublish results for a class
router.post('/unpublish', (req, res) => {
    const { class: className } = req.body;
    if (!className) {
        return res.status(400).json({ success: false, message: 'Class is required' });
    }
    db.query(
        `SELECT s.id, r.id as result_id 
         FROM students s 
         INNER JOIN results r ON s.id = r.student_id 
         WHERE s.class = ? AND s.result_status = 'published'`,
        [className],
        (err, students) => {
            if (err) {
                console.error('❌ Error fetching students:', err);
                return res.status(500).json({ success: false, message: err.message });
            }
            if (!students || students.length === 0) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'No published results found for this class' 
                });
            }
            const resultIds = students.map(s => s.result_id);
            const placeholders = resultIds.map(() => '?').join(',');
            db.query(
                `UPDATE results SET is_published = false, published_at = NULL 
                 WHERE id IN (${placeholders})`,
                resultIds,
                (updateErr) => {
                    if (updateErr) {
                        console.error('❌ Error unpublishing results:', updateErr);
                        return res.status(500).json({ success: false, message: updateErr.message });
                    }
                    const studentIds = students.map(s => s.id);
                    const studentPlaceholders = studentIds.map(() => '?').join(',');
                    db.query(
                        `UPDATE students SET result_status = 'uploaded' 
                         WHERE id IN (${studentPlaceholders})`,
                        studentIds,
                        (statusErr) => {
                            if (statusErr) console.error('⚠️ Status update error:', statusErr);
                            res.json({ 
                                success: true, 
                                message: `Results unpublished for ${students.length} students in class ${className}` 
                            });
                        }
                    );
                }
            );
        }
    );
});

// Delete result
router.delete('/:studentId', (req, res) => {
    const { studentId } = req.params;
    db.query('SELECT * FROM results WHERE student_id = ?', [studentId], async (err, results) => {
        if (err) {
            console.error('❌ Error fetching result:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Result not found' });
        }
        const result = results[0];
        try {
            await cloudinary.uploader.destroy(result.public_id);
        } catch (cloudinaryErr) {
            console.warn('⚠️ Cloudinary delete warning:', cloudinaryErr.message);
        }
        db.query('DELETE FROM results WHERE student_id = ?', [studentId], (deleteErr) => {
            if (deleteErr) {
                console.error('❌ Error deleting result:', deleteErr);
                return res.status(500).json({ success: false, message: deleteErr.message });
            }
            db.query('UPDATE students SET result_status = "pending" WHERE id = ?', [studentId]);
            res.json({ success: true, message: 'Result deleted successfully' });
        });
    });
});

// Setup tables
router.post('/setup', (req, res) => {
    const queries = [
        `CREATE TABLE IF NOT EXISTS students (
            id INT PRIMARY KEY AUTO_INCREMENT,
            student_name VARCHAR(100) NOT NULL,
            father_name VARCHAR(100) NOT NULL,
            mother_name VARCHAR(100) NOT NULL,
            student_id VARCHAR(50) UNIQUE NOT NULL,
            apaar_id VARCHAR(50) NOT NULL,
            class VARCHAR(10) NOT NULL,
            aahar_number VARCHAR(20) NOT NULL,
            exam_roll_no VARCHAR(50) NOT NULL,
            date_of_birth DATE NOT NULL,
            session VARCHAR(20) NOT NULL,
            exam_type ENUM('midterm', 'final', 'other') NOT NULL,
            stream VARCHAR(20) DEFAULT '',
            result_status ENUM('pending', 'uploaded', 'published') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_class (class),
            INDEX idx_student_id (student_id),
            INDEX idx_result_status (result_status)
        )`,
        `CREATE TABLE IF NOT EXISTS results (
            id INT PRIMARY KEY AUTO_INCREMENT,
            student_id INT NOT NULL,
            marksheet_url VARCHAR(500) NOT NULL,
            public_id VARCHAR(200) NOT NULL,
            is_published BOOLEAN DEFAULT FALSE,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            published_at TIMESTAMP NULL,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            INDEX idx_student_id (student_id),
            INDEX idx_is_published (is_published)
        )`
    ];
    let completed = 0;
    let errors = [];
    queries.forEach((query, index) => {
        db.query(query, (err) => {
            if (err) {
                console.error(`❌ Error creating table ${index + 1}:`, err.message);
                errors.push(`Table ${index + 1}: ${err.message}`);
            } else {
                console.log(`✅ Table ${index + 1} created/verified`);
            }
            completed++;
            if (completed === queries.length) {
                if (errors.length > 0) {
                    res.status(500).json({ 
                        success: false, 
                        message: 'Some tables failed to create', 
                        errors 
                    });
                } else {
                    res.json({ 
                        success: true, 
                        message: 'All tables created successfully!' 
                    });
                }
            }
        });
    });
});

module.exports = router;
