// ============================================================
// SECURITY CONFIGURATION
// ============================================================
const crypto = require('crypto');

// Generate secure random tokens
const generateSecureToken = (length = 32) => {
    return crypto.randomBytes(length).toString('hex');
};

// Hash password with salt
const hashPassword = async (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
};

// Verify password
const verifyPassword = async (password, storedHash) => {
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
};

// Sanitize input - Prevent XSS
const sanitizeInput = (input) => {
    if (!input) return '';
    if (typeof input !== 'string') return input;
    
    // Remove HTML tags
    return input
        .replace(/<[^>]*>/g, '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
};

// Validate SQL input - Prevent SQL Injection
const validateSQLInput = (input) => {
    if (!input) return '';
    if (typeof input !== 'string') return input;
    
    // Remove dangerous SQL characters
    return input.replace(/['";]/g, '');
};

// Rate limiting store (in-memory)
const rateLimitStore = new Map();

const checkRateLimit = (key, windowMs = 15 * 60 * 1000, max = 100) => {
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };
    
    if (now > record.resetTime) {
        record.count = 0;
        record.resetTime = now + windowMs;
    }
    
    record.count++;
    rateLimitStore.set(key, record);
    
    return {
        allowed: record.count <= max,
        remaining: Math.max(0, max - record.count),
        resetTime: record.resetTime
    };
};

// Clean up rate limit store (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore) {
        if (now > record.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Session timeout tracking
const sessionStore = new Map();

const startSession = (userId, expiryMinutes = 30) => {
    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;
    sessionStore.set(userId, { expiresAt });
    return { userId, expiresAt };
};

const checkSession = (userId) => {
    const session = sessionStore.get(userId);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        sessionStore.delete(userId);
        return false;
    }
    return true;
};

const extendSession = (userId, extraMinutes = 15) => {
    const session = sessionStore.get(userId);
    if (session) {
        session.expiresAt += extraMinutes * 60 * 1000;
        return true;
    }
    return false;
};

module.exports = {
    generateSecureToken,
    hashPassword,
    verifyPassword,
    sanitizeInput,
    validateSQLInput,
    checkRateLimit,
    startSession,
    checkSession,
    extendSession,
    sessionStore
};
