// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================
const jwt = require('jsonwebtoken');
const { checkRateLimit, checkSession } = require('../config/security');

// Verify JWT Token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'No token provided'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = decoded;
        
        // Check if session is still valid
        if (!checkSession(decoded.id)) {
            return res.status(401).json({
                success: false,
                message: 'Session expired'
            });
        }
        
        // Add rate limiting check
        const rateLimitKey = `admin_${decoded.id}`;
        const rateCheck = checkRateLimit(rateLimitKey, 60 * 60 * 1000, 1000); // 1000 requests per hour
        
        if (!rateCheck.allowed) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.'
            });
        }
        
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

// Optional: Verify with refresh token
const verifyRefreshToken = (req, res, next) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
        return res.status(401).json({
            success: false,
            message: 'Refresh token required'
        });
    }

    try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        req.refreshData = decoded;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Invalid refresh token'
        });
    }
};

// CSRF Verification
const verifyCsrf = (req, res, next) => {
    // Skip for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const csrfToken = req.headers['x-csrf-token'];
    const sessionToken = req.session?.csrfToken;

    if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
        return res.status(403).json({
            success: false,
            message: 'Invalid CSRF token'
        });
    }

    next();
};

// Rate limiting for API endpoints
const rateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const check = checkRateLimit(key, windowMs, max);
        
        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', check.remaining);
        res.setHeader('X-RateLimit-Reset', new Date(check.resetTime).toISOString());
        
        if (!check.allowed) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.'
            });
        }
        
        next();
    };
};

// Role-based access control
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        if (!roles.includes(req.admin.role)) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions'
            });
        }
        
        next();
    };
};

// Login attempt tracking (in-memory)
const loginAttempts = new Map();

const checkLoginAttempts = (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const attempt = loginAttempts.get(key) || { count: 0, firstAttempt: now };
    
    // Reset after 15 minutes
    if (now - attempt.firstAttempt > 15 * 60 * 1000) {
        attempt.count = 0;
        attempt.firstAttempt = now;
    }
    
    if (attempt.count >= 5) {
        return res.status(429).json({
            success: false,
            message: 'Too many login attempts. Please try again after 15 minutes.',
            retryAfter: Math.ceil((15 * 60 * 1000 - (now - attempt.firstAttempt)) / 1000)
        });
    }
    
    req._loginAttempt = attempt;
    next();
};

const recordLoginAttempt = (req, success) => {
    const key = req.ip || req.connection.remoteAddress;
    const attempt = req._loginAttempt || loginAttempts.get(key) || { count: 0, firstAttempt: Date.now() };
    
    if (success) {
        loginAttempts.delete(key);
    } else {
        attempt.count++;
        loginAttempts.set(key, attempt);
    }
};

module.exports = {
    verifyToken,
    verifyRefreshToken,
    verifyCsrf,
    rateLimiter,
    requireRole,
    checkLoginAttempts,
    recordLoginAttempt
};
