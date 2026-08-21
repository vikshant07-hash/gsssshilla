const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

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
// IN-MEMORY STORAGE (No Database)
// ================================================================
let certificates = [];

// ================================================================
// GENERATE PERMANENT VERIFICATION CODE (Based on Student ID)
// ================================================================
function generateVerificationCode(studentId) {
    const prefix = 'BC';
    const year = new Date().getFullYear().toString().slice(-2);
    const idPart = studentId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // Generate hash from student ID
    const hash = idPart.split('').reduce((acc, char) => {
        return acc + char.charCodeAt(0);
    }, 0).toString(36).toUpperCase().slice(-4);
    return `${prefix}${year}-${idPart.slice(0, 6)}-${hash}`;
}

// ================================================================
// GET OR CREATE CERTIFICATE FOR STUDENT
// ================================================================
function getOrCreateCertificate(studentId) {
    // Check if certificate already exists for this student
    let existing = certificates.find(c => c.studentId === studentId);

    if (existing) {
        return existing;
    }

    // Create new certificate with permanent verification code
    const verificationCode = generateVerificationCode(studentId);
    const newCert = {
        id: uuidv4(),
        studentId: studentId,
        verificationCode: verificationCode,
        createdAt: new Date().toISOString(),
        studentName: '',
        fatherName: '',
        motherName: '',
        className: '',
        section: '',
        session: '2025-26',
        admissionNo: '',
        dob: '',
        purpose: 'General',
        address: '',
        phone: '',
        photo: '',
        apaarId: '',
        examRollNo: '',
        qrCode: '',
        updatedAt: new Date().toISOString()
    };
    certificates.push(newCert);
    return newCert;
}

// ================================================================
// 1. GENERATE/UPDATE BONAFIDE CERTIFICATE
// POST /api/bonafide/generate
// ================================================================
router.post('/generate', authenticate, async (req, res) => {
    try {
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

        // Validation
        if (!studentId || !studentName || !fatherName || !className || !admissionNo) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: studentId, studentName, fatherName, className, admissionNo'
            });
        }

        // Get or create certificate with permanent verification code
        let certificate = getOrCreateCertificate(studentId);

        // Update certificate data
        certificate.studentName = studentName;
        certificate.fatherName = fatherName;
        certificate.motherName = motherName || '';
        certificate.className = className;
        certificate.section = section || '';
        certificate.session = session || '2025-26';
        certificate.admissionNo = admissionNo;
        certificate.dob = dob || '';
        certificate.purpose = purpose || 'General';
        certificate.address = address || '';
        certificate.phone = phone || '';
        certificate.photo = photo || '';
        certificate.apaarId = apaarId || '';
        certificate.examRollNo = examRollNo || '';
        certificate.updatedAt = new Date().toISOString();

        // Generate QR Code with permanent verification code
        const verificationUrl = `https://gsssshilla07.pages.dev/verify3.html?code=${certificate.verificationCode}`;
        const qrCodeDataURL = await QRCode.toDataURL(verificationUrl, {
            width: 150,
            margin: 2,
            color: {
                dark: '#1a1a2e',
                light: '#ffffff'
            }
        });
        certificate.qrCode = qrCodeDataURL;

        return res.json({
            success: true,
            message: certificate.createdAt === certificate.updatedAt ?
                'Bonafide certificate generated successfully' :
                'Bonafide certificate updated successfully',
            data: {
                certificate,
                verificationCode: certificate.verificationCode,
                qrCode: qrCodeDataURL,
                isNew: certificate.createdAt === certificate.updatedAt
            }
        });

    } catch (error) {
        console.error('Generate error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate certificate'
        });
    }
});

// ================================================================
// 2. GET CERTIFICATE BY STUDENT ID
// GET /api/bonafide/student/:studentId
// ================================================================
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;
        const certificate = certificates.find(c => c.studentId === studentId);

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'No certificate found for this student'
            });
        }

        return res.json({
            success: true,
            data: certificate
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 3. GET ALL CERTIFICATES (with filters)
// GET /api/bonafide/all?class=10&search=name
// ================================================================
router.get('/all', authenticate, async (req, res) => {
    try {
        const { class: classFilter, search, limit = 100, page = 1 } = req.query;

        let filtered = certificates;

        // Filter by class
        if (classFilter) {
            filtered = filtered.filter(c => c.className === classFilter);
        }

        // Search by name or student ID
        if (search) {
            const searchLower = search.toLowerCase();
            filtered = filtered.filter(c =>
                c.studentName.toLowerCase().includes(searchLower) ||
                c.studentId.toLowerCase().includes(searchLower) ||
                c.admissionNo.toLowerCase().includes(searchLower)
            );
        }

        // Sort by updatedAt descending
        filtered.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

        const start = (page - 1) * limit;
        const end = start + parseInt(limit);

        return res.json({
            success: true,
            data: filtered.slice(start, end),
            pagination: {
                total: filtered.length,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(filtered.length / limit)
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 4. GET CERTIFICATE BY VERIFICATION CODE
// GET /api/bonafide/verify/:code
// ================================================================
router.get('/verify/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const certificate = certificates.find(c => c.verificationCode === code);

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found or invalid verification code'
            });
        }

        return res.json({
            success: true,
            data: {
                studentName: certificate.studentName,
                fatherName: certificate.fatherName,
                motherName: certificate.motherName,
                className: certificate.className,
                section: certificate.section,
                admissionNo: certificate.admissionNo,
                session: certificate.session,
                dob: certificate.dob,
                purpose: certificate.purpose,
                verificationCode: certificate.verificationCode,
                issueDate: certificate.updatedAt || certificate.createdAt,
                isValid: true
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 5. DELETE CERTIFICATE
// DELETE /api/bonafide/:studentId
// ================================================================
router.delete('/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;
        const index = certificates.findIndex(c => c.studentId === studentId);

        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found'
            });
        }

        certificates.splice(index, 1);
        return res.json({
            success: true,
            message: 'Certificate deleted successfully'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 6. GET STATISTICS
// GET /api/bonafide/stats
// ================================================================
router.get('/stats', authenticate, async (req, res) => {
    try {
        const total = certificates.length;
        const today = new Date().toISOString().split('T')[0];
        const todayCount = certificates.filter(c =>
            c.updatedAt && c.updatedAt.startsWith(today)
        ).length;

        const classStats = {};
        certificates.forEach(c => {
            const cls = c.className || 'Unknown';
            classStats[cls] = (classStats[cls] || 0) + 1;
        });

        return res.json({
            success: true,
            data: {
                total,
                today: todayCount,
                classStats,
                latest: certificates.slice(0, 10)
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 7. GET STUDENT DETAILS (Integration with existing API)
// GET /api/bonafide/student-details/:studentId
// ================================================================
router.get('/student-details/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;

        // Call your existing student API
        const response = await fetch(`https://gsssshilla.onrender.com/api/admin/results/students/${studentId}`, {
            headers: {
                'Authorization': req.headers.authorization || ''
            }
        });

        if (!response.ok) {
            throw new Error('Student not found');
        }

        const data = await response.json();
        return res.json(data);
    } catch (error) {
        return res.status(404).json({
            success: false,
            message: error.message || 'Student not found'
        });
    }
});

module.exports = router;
