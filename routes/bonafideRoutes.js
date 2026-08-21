const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

// Generate Verification Code
function generateVerificationCode(studentId) {
    const now = new Date();
    const datePart = now.getFullYear().toString().slice(-2) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const initials = studentId.split('-').map(w => w[0]).join('').toUpperCase().slice(0, 4);
    return `BC-${datePart}-${initials}-${randomPart}`;
}

// Store certificates in memory (use MongoDB in production)
let certificates = [];

// ================================================================
// GENERATE BONAFIDE CERTIFICATE
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

        // Validate required fields
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
            width: 120,
            margin: 2,
            color: {
                dark: '#1a1a2e',
                light: '#ffffff'
            }
        });

        // Save certificate record
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

        // Return response
        res.json({
            success: true,
            message: 'Bonafide certificate generated successfully',
            data: {
                certificate,
                verificationCode,
                qrCode: qrCodeDataURL
            }
        });

    } catch (error) {
        console.error('Error generating bonafide:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to generate certificate' 
        });
    }
});

// ================================================================
// GET ALL CERTIFICATES
// ================================================================
router.get('/all', authenticate, async (req, res) => {
    try {
        const { studentId, limit = 50, page = 1 } = req.query;
        
        let filtered = certificates;
        if (studentId) {
            filtered = filtered.filter(c => c.studentId === studentId);
        }
        
        const start = (page - 1) * limit;
        const end = start + parseInt(limit);
        
        res.json({
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
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// GET CERTIFICATE BY VERIFICATION CODE
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

        res.json({
            success: true,
            data: {
                studentName: certificate.studentName,
                fatherName: certificate.fatherName,
                className: certificate.className,
                admissionNo: certificate.admissionNo,
                verificationCode: certificate.verificationCode,
                issueDate: certificate.issueDate,
                isValid: true
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// DELETE CERTIFICATE
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
        res.json({
            success: true,
            message: 'Certificate deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// PRINT BONAFIDE CERTIFICATE (HTML Version)
// ================================================================
router.post('/print', authenticate, async (req, res) => {
    try {
        const data = req.body;
        
        // Generate QR Code
        const verificationCode = generateVerificationCode(data.studentId);
        const verificationUrl = `https://gsssshilla07.pages.dev/verify.html?code=${verificationCode}`;
        const qrCodeDataURL = await QRCode.toDataURL(verificationUrl, {
            width: 120,
            margin: 2,
            color: {
                dark: '#1a1a2e',
                light: '#ffffff'
            }
        });

        // Prepare certificate data
        const certData = {
            ...data,
            verificationCode,
            qrCode: qrCodeDataURL,
            issueDate: new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
            })
        };

        res.json({
            success: true,
            data: certData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
