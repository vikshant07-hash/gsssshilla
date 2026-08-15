const express = require('express');
const router = express.Router();
const { db } = require('../config/db');
const { cloudinary } = require('../config/cloudinary');
const path = require('path');
const fs = require('fs-extra');

// ============================================================
// STUDENT ROUTES
// ============================================================

// GET all students (with optional class filter)
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

// GET single student by ID
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

// POST create new student
router.post('/students', (req, res) => {
    const {
        studentName, fatherName, motherName, studentId, apaarId,
        class: className, aaharNumber, examRollNo, dateOfBirth,
        session, examType, stream, studentPhoto
    } = req.body;

    // Validation
    if (!studentName || !fatherName || !motherName || !studentId || !apaarId ||
        !className || !aaharNumber || !examRollNo || !dateOfBirth ||
        !session || !examType || !studentPhoto) {
        return res.status(400).json({ 
            success: false, 
            message: 'All fields are required' 
        });
    }

    // Check duplicate student_id
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
                session, exam_type, stream, student_photo, result_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `;

        db.query(query, [
            studentName, fatherName, motherName, studentId, apaarId,
            className, aaharNumber, examRollNo, dateOfBirth,
            session, examType, stream || '', studentPhoto
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

// PUT update student
router.put('/students/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // Check if student exists
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
            'date_of_birth', 'session', 'exam_type', 'stream', 'student_photo'
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

    // Check if student exists
    db.query('SELECT * FROM students WHERE id = ?', [id], (err, results) => {
        if (err) {
            console.error('❌ Error checking student:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // Delete student (cascade will delete results)
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

// Upload marksheet (PDF) for a student
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
        
        // Validate file type
        if (file.mimetype !== 'application/pdf') {
            return res.status(400).json({ success: false, message: 'Only PDF files are allowed' });
        }

        // Check if student exists
        db.query('SELECT * FROM students WHERE id = ?', [studentId], async (err, studentResults) => {
            if (err) {
                console.error('❌ Error checking student:', err);
                return res.status(500).json({ success: false, message: err.message });
            }
            if (!studentResults || studentResults.length === 0) {
                return res.status(404).json({ success: false, message: 'Student not found' });
            }

            try {
                // Upload to Cloudinary
                const result = await cloudinary.uploader.upload(file.tempFilePath, {
                    folder: 'results',
                    resource_type: 'auto',
                    allowed_formats: ['pdf']
                });

                // Check if result already exists
                db.query('SELECT id FROM results WHERE student_id = ?', [studentId], (err2, existingResult) => {
                    if (err2) {
                        console.error('❌ Error checking existing result:', err2);
                        return res.status(500).json({ success: false, message: err2.message });
                    }

                    if (existingResult && existingResult.length > 0) {
                        // Update existing result
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

                                // Update student status
                                db.query('UPDATE students SET result_status = "uploaded" WHERE id = ?', [studentId], (statusErr) => {
                                    if (statusErr) console.error('⚠️ Status update error:', statusErr);
                                });

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
                        // Insert new result
                        db.query(
                            `INSERT INTO results (student_id, marksheet_url, public_id) 
                             VALUES (?, ?, ?)`,
                            [studentId, result.secure_url, result.public_id],
                            (insertErr, insertResult) => {
                                if (insertErr) {
                                    console.error('❌ Error inserting result:', insertErr);
                                    return res.status(500).json({ success: false, message: insertErr.message });
                                }

                                // Update student status
                                db.query('UPDATE students SET result_status = "uploaded" WHERE id = ?', [studentId], (statusErr) => {
                                    if (statusErr) console.error('⚠️ Status update error:', statusErr);
                                });

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

// Get result status for a student
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

    // Get all students in class with uploaded results
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

            // Update all results as published
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

                    // Update all students status
                    const studentIds = students.map(s => s.id);
                    const studentPlaceholders = studentIds.map(() => '?').join(',');
                    
                    db.query(
                        `UPDATE students SET result_status = 'published' 
                         WHERE id IN (${studentPlaceholders})`,
                        studentIds,
                        (statusErr) => {
                            if (statusErr) {
                                console.error('⚠️ Status update error:', statusErr);
                            }
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

    // Get all students in class with published results
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

            // Update all results as unpublished
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

                    // Update all students status
                    const studentIds = students.map(s => s.id);
                    const studentPlaceholders = studentIds.map(() => '?').join(',');
                    
                    db.query(
                        `UPDATE students SET result_status = 'uploaded' 
                         WHERE id IN (${studentPlaceholders})`,
                        studentIds,
                        (statusErr) => {
                            if (statusErr) {
                                console.error('⚠️ Status update error:', statusErr);
                            }
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

// Delete result for a student
router.delete('/:studentId', (req, res) => {
    const { studentId } = req.params;
    
    // Get result details
    db.query('SELECT * FROM results WHERE student_id = ?', [studentId], async (err, results) => {
        if (err) {
            console.error('❌ Error fetching result:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        
        if (!results || results.length === 0) {
            return res.status(404).json({ success: false, message: 'Result not found' });
        }

        const result = results[0];
        
        // Delete from Cloudinary
        try {
            await cloudinary.uploader.destroy(result.public_id);
        } catch (cloudinaryErr) {
            console.warn('⚠️ Cloudinary delete warning:', cloudinaryErr.message);
        }

        // Delete from database
        db.query('DELETE FROM results WHERE student_id = ?', [studentId], (deleteErr) => {
            if (deleteErr) {
                console.error('❌ Error deleting result:', deleteErr);
                return res.status(500).json({ success: false, message: deleteErr.message });
            }
            
            // Update student status
            db.query('UPDATE students SET result_status = "pending" WHERE id = ?', [studentId], (statusErr) => {
                if (statusErr) console.error('⚠️ Status update error:', statusErr);
            });
            
            res.json({ success: true, message: 'Result deleted successfully' });
        });
    });
});

// ============================================================
// TABLE CREATION ROUTE (One-time setup)
// ============================================================

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
            student_photo VARCHAR(500) NOT NULL,
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
                        message: 'All tables created successfully! Students and Results tables are ready.' 
                    });
                }
            }
        });
    });
});

module.exports = router;
