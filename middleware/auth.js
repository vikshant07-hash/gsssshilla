const jwt = require('jsonwebtoken');

/**
 * Authentication Middleware
 * Protects all routes except public ones
 */
const authMiddleware = (req, res, next) => {
    // 🔓 Public Routes - Inhe token ki zaroorat nahi
    const publicPaths = [
        '/',
        '/test',
        '/login',
        '/register',
        '/api/admin/login',
        '/api/admin/register',
        '/contact',
        '/analytics/track'
    ];

    // Check if current path is public
    if (publicPaths.includes(req.path) || req.path.startsWith('/api/public/')) {
        return next();
    }

    // 🔑 Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: '❌ Access Denied! No token provided.',
            error: 'UNAUTHORIZED'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        
        // Attach user data to request
        req.user = decoded;
        req.userId = decoded.id || decoded.userId;
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: '❌ Token expired! Please login again.',
                error: 'TOKEN_EXPIRED'
            });
        }
        
        return res.status(403).json({
            success: false,
            message: '❌ Invalid token!',
            error: 'INVALID_TOKEN'
        });
    }
};

module.exports = authMiddleware;
