const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

// ================================================================
// AUTH MIDDLEWARE
// ================================================================
const authenticate = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key_123');
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

// ================================================================
// GENERATE 12-CHARACTER VERIFICATION CODE
// ================================================================
function generateVerificationCode(studentId, apaarId) {
    const combined = `${studentId}-${apaarId}-${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    let code = Math.abs(hash).toString(36).toUpperCase();
    while (code.length < 12) {
        code = 'A' + code;
    }
    return code.slice(0, 12);
}

// ================================================================
// 1. VALIDATE UNIQUE IDs
// ================================================================
router.post('/validate-unique', authenticate, async (req, res) => {
    try {
        const { studentId, apaarId } = req.body;

        if (!studentId) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: 'Student ID is required'
            });
        }

        const existing = await query(
            'SELECT student_id, apaar_id FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        if (existing.length > 0) {
            if (apaarId && existing[0].apaar_id !== apaarId) {
                const apaarExists = await query(
                    'SELECT id FROM bonafide_certificates WHERE apaar_id = ? AND student_id != ?',
                    [apaarId, studentId]
                );
                if (apaarExists.length > 0) {
                    return res.json({
                        success: true,
                        valid: false,
                        message: 'APAAR ID already exists for another student'
                    });
                }
            }
            return res.json({
                success: true,
                valid: true,
                message: 'Updating existing certificate'
            });
        }

        if (apaarId) {
            const apaarExists = await query(
                'SELECT id FROM bonafide_certificates WHERE apaar_id = ?',
                [apaarId]
            );
            if (apaarExists.length > 0) {
                return res.json({
                    success: true,
                    valid: false,
                    message: 'APAAR ID already exists'
                });
            }
        }

        return res.json({
            success: true,
            valid: true,
            message: 'IDs are unique'
        });

    } catch (error) {
        console.error('Validate error:', error);
        return res.status(500).json({
            success: false,
            valid: false,
            message: error.message
        });
    }
});

// ================================================================
// 2. GENERATE/UPDATE BONAFIDE CERTIFICATE
// ================================================================
router.post('/generate', authenticate, async (req, res) => {
    try {
        console.log('📥 Generate Request Body:', req.body);

        const {
            studentId,
            studentName,
            fatherName,
            motherName,
            className,
            section,
            session,
            admissionNo,
            dob,
            purpose,
            address,
            phone,
            photo,
            apaarId,
            examRollNo
        } = req.body;

        // ============================================================
        // VALIDATION
        // ============================================================
        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Student ID is required' });
        }
        if (!studentName) {
            return res.status(400).json({ success: false, message: 'Student Name is required' });
        }
        if (!fatherName) {
            return res.status(400).json({ success: false, message: 'Father\'s Name is required' });
        }
        if (!className) {
            return res.status(400).json({ success: false, message: 'Class is required' });
        }
        if (!admissionNo) {
            return res.status(400).json({ success: false, message: 'Admission Number is required' });
        }
        if (!apaarId) {
            return res.status(400).json({ success: false, message: 'APAAR ID is required' });
        }
        if (!dob || dob.trim() === '') {
            return res.status(400).json({ success: false, message: 'Date of Birth is required' });
        }

        // Validate APAAR ID format
        if (!/^[A-Za-z0-9]{12}$/.test(apaarId)) {
            return res.status(400).json({
                success: false,
                message: 'APAAR ID must be exactly 12 alphanumeric characters'
            });
        }

        // Validate date format
        const dobDate = new Date(dob);
        if (isNaN(dobDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Date of Birth format'
            });
        }

        // ============================================================
        // CHECK IF CERTIFICATE EXISTS
        // ============================================================
        const existing = await query(
            'SELECT * FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        let isNew = false;

        if (existing.length > 0) {
            // UPDATE EXISTING
            await query(`
                UPDATE bonafide_certificates SET
                    apaar_id = ?,
                    student_name = ?,
                    father_name = ?,
                    mother_name = ?,
                    class_name = ?,
                    section = ?,
                    session = ?,
                    admission_no = ?,
                    dob = ?,
                    purpose = ?,
                    address = ?,
                    phone = ?,
                    photo = ?,
                    exam_roll_no = ?,
                    updated_at = NOW()
                WHERE student_id = ?
            `, [
                apaarId,
                studentName,
                fatherName,
                motherName || '',
                className,
                section || '',
                session || '2025-26',
                admissionNo,
                dob,
                purpose || 'General',
                address || '',
                phone || '',
                photo || '',
                examRollNo || '',
                studentId
            ]);

            isNew = false;
        } else {
            // CREATE NEW
            const verificationCode = generateVerificationCode(studentId, apaarId);
            const id = uuidv4();

            await query(`
                INSERT INTO bonafide_certificates (
                    id, student_id, apaar_id, verification_code,
                    student_name, father_name, mother_name,
                    class_name, section, session, admission_no,
                    dob, purpose, address, phone, photo,
                    exam_roll_no, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
                id,
                studentId,
                apaarId,
                verificationCode,
                studentName,
                fatherName,
                motherName || '',
                className,
                section || '',
                session || '2025-26',
                admissionNo,
                dob,
                purpose || 'General',
                address || '',
                phone || '',
                photo || '',
                examRollNo || ''
            ]);

            isNew = true;
        }

        // ============================================================
        // GET UPDATED CERTIFICATE
        // ============================================================
        const certificate = await query(
            'SELECT * FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        const cert = certificate[0];

        // ============================================================
        // GENERATE QR CODE
        // ============================================================
        const verificationUrl = `https://gsssshilla07.pages.dev/verify3.html?code=${cert.verification_code}`;
        const qrCodeDataURL = await QRCode.toDataURL(verificationUrl, {
            width: 150,
            margin: 2,
            color: {
                dark: '#1a1a2e',
                light: '#ffffff'
            }
        });

        // Update QR code
        await query(
            'UPDATE bonafide_certificates SET qr_code = ? WHERE student_id = ?',
            [qrCodeDataURL, studentId]
        );

        // ============================================================
        // FINAL RESPONSE
        // ============================================================
        const finalCert = await query(
            'SELECT * FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        const c = finalCert[0];

        const responseData = {
            certificate: {
                studentId: c.student_id,
                apaarId: c.apaar_id,
                studentName: c.student_name,
                fatherName: c.father_name,
                motherName: c.mother_name,
                className: c.class_name,
                section: c.section,
                session: c.session,
                admissionNo: c.admission_no,
                dob: c.dob,
                purpose: c.purpose,
                address: c.address,
                phone: c.phone,
                photo: c.photo,
                examRollNo: c.exam_roll_no,
                verificationCode: c.verification_code,
                qrCode: qrCodeDataURL,
                createdAt: c.created_at,
                updatedAt: c.updated_at
            },
            verificationCode: c.verification_code,
            qrCode: qrCodeDataURL,
            isNew: isNew
        };

        return res.json({
            success: true,
            message: isNew ? 'Bonafide certificate generated successfully' : 'Bonafide certificate updated successfully',
            data: responseData
        });

    } catch (error) {
        console.error('❌ Generate error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate certificate'
        });
    }
});

// ================================================================
// 3. GET CERTIFICATE BY STUDENT ID
// ================================================================
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;

        const certificate = await query(
            'SELECT * FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        if (certificate.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No certificate found for this student'
            });
        }

        return res.json({
            success: true,
            data: certificate[0]
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 4. GET ALL CERTIFICATES
// ================================================================
router.get('/all', authenticate, async (req, res) => {
    try {
        const { class: classFilter, search, limit = 20, page = 1 } = req.query;

        let sql = 'SELECT * FROM bonafide_certificates WHERE 1=1';
        const params = [];

        if (classFilter) {
            sql += ' AND class_name = ?';
            params.push(classFilter);
        }

        if (search) {
            sql += ' AND (student_name LIKE ? OR student_id LIKE ? OR admission_no LIKE ? OR verification_code LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
        const offset = (parseInt(page) - 1) * parseInt(limit);
        params.push(parseInt(limit), offset);

        const certificates = await query(sql, params);

        // Count total
        let countSql = 'SELECT COUNT(*) as total FROM bonafide_certificates WHERE 1=1';
        const countParams = [];
        if (classFilter) {
            countSql += ' AND class_name = ?';
            countParams.push(classFilter);
        }
        if (search) {
            countSql += ' AND (student_name LIKE ? OR student_id LIKE ? OR admission_no LIKE ? OR verification_code LIKE ?)';
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }
        const countResult = await query(countSql, countParams);
        const total = countResult[0]?.total || 0;

        return res.json({
            success: true,
            data: certificates,
            pagination: {
                total: total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 5. VERIFY BY CODE (PUBLIC)
// ================================================================
router.get('/verify/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const certificate = await query(
            'SELECT * FROM bonafide_certificates WHERE verification_code = ?',
            [code]
        );

        if (certificate.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found or invalid verification code'
            });
        }

        const cert = certificate[0];

        return res.json({
            success: true,
            data: {
                studentId: cert.student_id,
                studentName: cert.student_name,
                fatherName: cert.father_name,
                motherName: cert.mother_name,
                className: cert.class_name,
                section: cert.section,
                admissionNo: cert.admission_no,
                session: cert.session,
                dob: cert.dob,
                purpose: cert.purpose,
                verificationCode: cert.verification_code,
                issueDate: cert.updated_at || cert.created_at,
                isValid: true
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 6. DELETE CERTIFICATE
// ================================================================
router.delete('/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;

        const existing = await query(
            'SELECT id FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found'
            });
        }

        await query(
            'DELETE FROM bonafide_certificates WHERE student_id = ?',
            [studentId]
        );

        return res.json({
            success: true,
            message: 'Certificate deleted successfully'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 7. GET STATISTICS
// ================================================================
router.get('/stats', authenticate, async (req, res) => {
    try {
        const totalResult = await query('SELECT COUNT(*) as total FROM bonafide_certificates');
        const total = totalResult[0]?.total || 0;

        const today = new Date().toISOString().split('T')[0];
        const todayResult = await query(
            'SELECT COUNT(*) as today FROM bonafide_certificates WHERE DATE(updated_at) = ?',
            [today]
        );
        const todayCount = todayResult[0]?.today || 0;

        const classStats = await query(`
            SELECT class_name, COUNT(*) as count 
            FROM bonafide_certificates 
            GROUP BY class_name 
            ORDER BY class_name
        `);

        const latest = await query(`
            SELECT * FROM bonafide_certificates 
            ORDER BY updated_at DESC 
            LIMIT 10
        `);

        return res.json({
            success: true,
            data: {
                total,
                today: todayCount,
                classStats,
                latest
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
