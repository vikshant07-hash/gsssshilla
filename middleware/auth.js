const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

module.exports = (req, res, next) => {
    console.log('🛡️ Auth middleware called for:', req.method, req.path);
    
    // ✅ STEP 1: Check Session First (For Dashboard)
    if (req.session && req.session.admin_id) {
        console.log('✅ Session valid for admin ID:', req.session.admin_id);
        console.log('✅ Admin Name:', req.session.admin_name || 'Unknown');
        return next();
    }
    
    // ✅ STEP 2: Check JWT Token (For Mobile/API)
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('❌ No session or token found for:', req.path);
        return res.status(401).json({
            success: false,
            message: 'Session expired. Please login again.',
            code: 'SESSION_EXPIRED'
        });
    }
    
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        console.log('✅ Token verified for:', decoded.username);
        next();
    } catch (error) {
        console.log('❌ Token verification failed:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.',
                code: 'TOKEN_EXPIRED'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token. Please login again.',
                code: 'INVALID_TOKEN'
            });
        }
        
        return res.status(401).json({
            success: false,
            message: 'Authentication failed. Please login again.',
            code: 'AUTH_FAILED'
        });
    }
};
