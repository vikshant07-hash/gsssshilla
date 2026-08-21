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
// IN-MEMORY STORAGE
// ================================================================
let certificates = [];

// ================================================================
// HELPERS
// ================================================================
function generateVerificationCode(studentId) {
    const now = new Date();
    const datePart = now.getFullYear().toString().slice(-2) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const initials = studentId.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'STU';
    return `BC-${datePart}-${initials}-${randomPart}`;
}

// ================================================================
// 1. GENERATE BONAFIDE CERTIFICATE
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

        // Generate verification code
        const verificationCode = generateVerificationCode(studentId);
        
        // Generate QR Code
        const verificationUrl = `https://gsssshilla07.pages.dev/verify.html?code=${verificationCode}`;
        const qrCodeDataURL = await QRCode.toDataURL(verificationUrl, {
            width: 150,
            margin: 2,
            color: {
                dark: '#1a1a2e',
                light: '#ffffff'
            }
        });

        // Create certificate record
        const certificate = {
            id: uuidv4(),
            studentId,
            studentName,
            fatherName,
            motherName: motherName || '',
            className,
            section: section || '',
            session: session || '2025-26',
            admissionNo,
            dob: dob || '',
            purpose: purpose || 'General',
            address: address || '',
            phone: phone || '',
            photo: photo || '',
            apaarId: apaarId || '',
            examRollNo: examRollNo || '',
            verificationCode,
            qrCode: qrCodeDataURL,
            issueDate: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        
        certificates.push(certificate);

        return res.json({
            success: true,
            message: 'Bonafide certificate generated successfully',
            data: {
                certificate,
                verificationCode,
                qrCode: qrCodeDataURL
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
// 2. GET ALL CERTIFICATES
// GET /api/bonafide/all
// ================================================================
router.get('/all', authenticate, async (req, res) => {
    try {
        const { studentId, limit = 50, page = 1 } = req.query;
        
        let filtered = certificates;
        if (studentId) {
            filtered = filtered.filter(c => c.studentId === studentId);
        }
        
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
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
// 3. GET CERTIFICATE BY VERIFICATION CODE
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
                admissionNo: certificate.admissionNo,
                session: certificate.session,
                dob: certificate.dob,
                purpose: certificate.purpose,
                verificationCode: certificate.verificationCode,
                issueDate: certificate.issueDate,
                isValid: true
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 4. DELETE CERTIFICATE
// DELETE /api/bonafide/:id
// ================================================================
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const index = certificates.findIndex(c => c.id === id);
        
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
// 5. GET STUDENT DETAILS (Integration with existing API)
// GET /api/bonafide/student/:studentId
// ================================================================
router.get('/student/:studentId', authenticate, async (req, res) => {
    try {
        const { studentId } = req.params;
        
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

// ================================================================
// 6. GET CERTIFICATE STATS
// GET /api/bonafide/stats
// ================================================================
router.get('/stats', authenticate, async (req, res) => {
    try {
        const total = certificates.length;
        const today = new Date().toISOString().split('T')[0];
        const todayCount = certificates.filter(c => 
            c.createdAt && c.createdAt.startsWith(today)
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
                latest: certificates.slice(0, 5)
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// 7. SEARCH CERTIFICATES
// GET /api/bonafide/search?q=text
// ================================================================
router.get('/search', authenticate, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json({ success: true, data: [] });
        }
        
        const searchLower = q.toLowerCase();
        const results = certificates.filter(c => 
            c.studentName.toLowerCase().includes(searchLower) ||
            c.studentId.toLowerCase().includes(searchLower) ||
            c.verificationCode.toLowerCase().includes(searchLower) ||
            c.admissionNo.toLowerCase().includes(searchLower)
        );
        
        return res.json({
            success: true,
            data: results
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
