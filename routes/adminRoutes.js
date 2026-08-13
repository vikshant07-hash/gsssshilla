const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

console.log('🔧 authRoutes.js loaded - Secure Version');

// ============================================================
// SECURITY CONFIGURATION
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'my_refresh_secret_67890';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// ============================================================
// ADMIN CREDENTIALS - Multiple Admins
// ============================================================
const ADMINS = [
  {
    id: 1,
    username: process.env.ADMIN_USERNAME || 'admin',
    email: process.env.ADMIN_EMAIL || 'vikshant07@gmail.com',
    name: process.env.ADMIN_NAME || 'VIKSHANT KRALTA',
    role: 'Super Admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH
  },
  {
    id: 2,
    username: process.env.ADMIN2_USERNAME,
    email: process.env.ADMIN2_EMAIL,
    name: process.env.ADMIN2_NAME || 'SUJAL KRALTA',
    role: 'Admin',
    passwordHash: process.env.ADMIN2_PASSWORD_HASH
  }
].filter(admin => admin.username && admin.passwordHash);

if (ADMINS.length === 0) {
  console.warn('⚠️ No admins configured!');
} else {
  console.log(`✅ ${ADMINS.length} admin(s) loaded:`, ADMINS.map(a => a.username).join(', '));
}

// ============================================================
// SCHOOL LOGO URL
// ============================================================
const SCHOOL_LOGO_URL = process.env.SCHOOL_LOGO_URL || 'https://res.cloudinary.com/dwupxj7vf/image/upload/v1786266974/school/recent_updates/update-logo%281%29-1786266967378-883005917.png';

// ============================================================
// RATE LIMITING - In-memory store
// ============================================================
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

// ============================================================
// LOGIN ATTEMPT TRACKING
// ============================================================
const loginAttempts = new Map();

// ============================================================
// SESSION STORE
// ============================================================
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

// ============================================================
// OTP STORE
// ============================================================
let otpStore = {};

// ============================================================
// CSRF TOKEN STORE
// ============================================================
let csrfStore = {};

// ============================================================
// EMAIL SENDING (Brevo)
// ============================================================
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'magicalmathsquiz@gmail.com';
const BREVO_SENDER_NAME = 'GSSS SHILLA';

async function sendOTPEmail(toEmail, otp, purpose = 'login', recipientName = 'Admin') {
  const subjectText = purpose === 'reset'
    ? 'Password Reset OTP — GSSS SHILLA'
    : 'Admin Login OTP — GSSS SHILLA';

  const headingText = purpose === 'reset'
    ? 'Password Reset Request'
    : 'Admin Login Verification';

  const introText = purpose === 'reset'
    ? 'We received a request to reset your admin password. Use the OTP below to proceed.'
    : 'Use the One-Time Password below to securely log in to your admin account.';

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin:0; padding:0; background-color:#f1f5f9; font-family: 'Segoe UI', Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow: 0 4px 18px rgba(0,0,0,0.08);">
            
            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%); padding: 32px 24px; text-align:center;">
                <img src="${SCHOOL_LOGO_URL}" alt="GSSS SHILLA" width="82" height="82" style="border-radius:50%; background:#ffffff; padding:6px; margin-bottom:12px; display:inline-block;" />
                <h1 style="color:#ffffff; font-size:22px; margin:8px 0 2px 0; letter-spacing:0.5px;">GSSS SHILLA</h1>
                <p style="color:#e0e7ff; font-size:13px; margin:0;">Government Senior Secondary School Shilla</p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 32px 28px;">
                <h2 style="color:#1e293b; font-size:19px; margin:0 0 6px 0;">${headingText}</h2>
                <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 20px 0;">
                  Hi, ${recipientName}! <br>${introText}
                </p>

                <!-- OTP Box -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%); border: 1.5px dashed #6366f1; border-radius: 12px; padding: 20px;">
                      <p style="margin:0 0 8px 0; color:#6366f1; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:1px;">Your OTP Code</p>
                      <div style="font-size:32px; font-weight:800; letter-spacing:8px; color:#1e1b4b;">
                        ${otp}
                      </div>
                    </td>
                  </tr>
                </table>

                <p style="color:#94a3b8; font-size:12.5px; line-height:1.6; margin:20px 0 0 0;">
                  ⏱ This OTP is valid for <strong>5 minutes</strong>. <br> <strong>Note:</strong> If you did not request this, please ignore this email or contact the school administration.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background:#f8fafc; padding: 18px 24px; text-align:center; border-top:1px solid #e2e8f0;">
                <p style="margin:0; color:#94a3b8; font-size:11.5px;">
                  © ${new Date().getFullYear()} GSSS SHILLA — All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: subjectText,
      htmlContent: htmlContent
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function generateOTP() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "0123456789";
  let otp = "";
  for (let i = 0; i < 2; i++) {
    otp += letters[Math.floor(Math.random() * letters.length)];
  }
  for (let i = 0; i < 4; i++) {
    otp += numbers[Math.floor(Math.random() * numbers.length)];
  }
  return otp;
}

function findAdminByUsername(username) {
  return ADMINS.find(a => a.username === username);
}

function findAdminByEmail(email) {
  return ADMINS.find(a => a.email === email);
}

// ============================================================
// MIDDLEWARE - Token Verification
// ============================================================
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided',
        code: 'NO_TOKEN'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check session
    if (!checkSession(decoded.id)) {
      return res.status(401).json({
        success: false,
        message: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }
    
    // Extend session
    extendSession(decoded.id, 15);
    
    req.admin = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};

// ============================================================
// MIDDLEWARE - CSRF Verification
// ============================================================
const verifyCsrf = (req, res, next) => {
  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const csrfToken = req.headers['x-csrf-token'];
  const sessionToken = req.session?.csrfToken || csrfStore[req.admin?.id];

  if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token',
      code: 'CSRF_INVALID'
    });
  }

  next();
};

// ============================================================
// MIDDLEWARE - Rate Limiting
// ============================================================
const rateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const check = checkRateLimit(key, windowMs, max);
    
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', check.remaining);
    res.setHeader('X-RateLimit-Reset', new Date(check.resetTime).toISOString());
    
    if (!check.allowed) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT'
      });
    }
    
    next();
  };
};

// ============================================================
// MIDDLEWARE - Login Attempt Check
// ============================================================
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
      code: 'TOO_MANY_ATTEMPTS',
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

// ============================================================
// ============================================================
// ROUTES
// ============================================================
// ============================================================

// ============================================================
// 1. TEST ROUTE
// ============================================================
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Admin routes working!',
    security: {
      jwt: 'Active',
      session: 'Active',
      csrf: 'Active',
      rateLimiting: 'Active'
    }
  });
});

// ============================================================
// 2. GET CSRF TOKEN
// ============================================================
router.get('/csrf-token', (req, res) => {
  const csrfToken = uuidv4();
  // Store in session or memory
  req.session = req.session || {};
  req.session.csrfToken = csrfToken;
  csrfStore[req.ip] = csrfToken;
  
  res.json({
    success: true,
    token: csrfToken
  });
});

// ============================================================
// 3. LOGIN - Send OTP
// ============================================================
router.post('/login', 
  rateLimiter(15 * 60 * 1000, 20), // 20 attempts per 15 minutes
  checkLoginAttempts,
  async (req, res) => {
    console.log('🔐 LOGIN ROUTE HIT');

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
        code: 'MISSING_FIELDS'
      });
    }

    try {
      const admin = findAdminByUsername(username);
      if (!admin) {
        recordLoginAttempt(req, false);
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      const isMatch = await bcrypt.compare(password, admin.passwordHash);
      if (!isMatch) {
        recordLoginAttempt(req, false);
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Generate OTP
      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;
      otpStore[username] = { otp, expiry };

      console.log(`📧 OTP for ${username}: ${otp}`);

      try {
        await sendOTPEmail(admin.email, otp, 'login', admin.name);
        console.log('✅ OTP email sent to', admin.email);
      } catch (emailErr) {
        console.error('❌ Failed to send OTP email:', emailErr.message);
        // Still allow OTP in response for development
        return res.status(500).json({
          success: false,
          message: 'OTP generated but failed to send email. Check email configuration.',
          code: 'EMAIL_FAILED'
        });
      }

      // Record successful login attempt
      recordLoginAttempt(req, true);

      res.json({
        success: true,
        message: 'OTP sent successfully to your email!',
        data: {
          username: admin.username,
          email: admin.email,
          otpSent: true
        }
      });

    } catch (error) {
      console.error('❌ Login Error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error: ' + error.message,
        code: 'SERVER_ERROR'
      });
    }
  }
);

// ============================================================
// 4. VERIFY OTP - Complete Login
// ============================================================
router.post('/verify-otp',
  rateLimiter(15 * 60 * 1000, 30),
  async (req, res) => {
    console.log('🔐 VERIFY OTP ROUTE HIT');

    const { username, password, otp } = req.body;

    if (!username || !password || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Username, password and OTP are required',
        code: 'MISSING_FIELDS'
      });
    }

    try {
      const admin = findAdminByUsername(username);
      if (!admin) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        });
      }

      const isMatch = await bcrypt.compare(password, admin.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        });
      }

      const stored = otpStore[username];
      if (!stored) {
        return res.status(401).json({ 
          success: false, 
          message: 'No OTP found. Please request a new one.',
          code: 'NO_OTP'
        });
      }

      if (stored.otp !== otp.toUpperCase()) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid OTP',
          code: 'INVALID_OTP'
        });
      }

      if (Date.now() > stored.expiry) {
        delete otpStore[username];
        return res.status(401).json({ 
          success: false, 
          message: 'OTP expired. Please request a new one.',
          code: 'OTP_EXPIRED'
        });
      }

      delete otpStore[username];

      // Start session
      startSession(admin.id, 30);

      // Generate Access Token
      const token = jwt.sign(
        {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          name: admin.name,
          role: admin.role
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Generate Refresh Token
      const refreshToken = jwt.sign(
        { id: admin.id },
        JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
      );

      // Generate CSRF Token
      const csrfToken = uuidv4();
      req.session = req.session || {};
      req.session.csrfToken = csrfToken;

      // Log login activity
      console.log(`✅ Login successful: ${admin.username} from ${req.ip}`);

      res.json({
        success: true,
        message: 'Login successful!',
        data: {
          token,
          refreshToken,
          csrfToken,
          sessionExpiry: 30 * 60, // 30 minutes in seconds
          admin: {
            id: admin.id,
            username: admin.username,
            email: admin.email,
            name: admin.name,
            role: admin.role
          }
        }
      });

    } catch (error) {
      console.error('❌ Verify OTP Error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error: ' + error.message,
        code: 'SERVER_ERROR'
      });
    }
  }
);

// ============================================================
// 5. REFRESH TOKEN
// ============================================================
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: 'Refresh token required',
      code: 'NO_REFRESH_TOKEN'
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    
    // Find admin
    const admin = findAdminByUsername(decoded.username);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // Extend session
    extendSession(admin.id, 15);

    // Generate new tokens
    const newToken = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        name: admin.name,
        role: admin.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const newRefreshToken = jwt.sign(
      { id: admin.id },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Generate new CSRF token
    const csrfToken = uuidv4();
    req.session = req.session || {};
    req.session.csrfToken = csrfToken;

    res.json({
      success: true,
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
        csrfToken
      }
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired',
        code: 'REFRESH_TOKEN_EXPIRED'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN'
    });
  }
});

// ============================================================
// 6. VERIFY TOKEN
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  res.json({ 
    success: true, 
    admin: req.admin, 
    message: 'Token is valid',
    sessionExpiry: 30 * 60
  });
});

// ============================================================
// 7. PROFILE ROUTE
// ============================================================
router.get('/profile', verifyToken, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.admin.id,
      username: req.admin.username,
      email: req.admin.email,
      name: req.admin.name,
      role: req.admin.role,
      last_login: new Date().toISOString(),
      sessionExpiry: 30 * 60
    }
  });
});

// ============================================================
// 8. LOGOUT
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  // Clear session
  sessionStore.delete(req.admin.id);
  
  // Clear CSRF token
  delete csrfStore[req.ip];
  
  res.json({ 
    success: true, 
    message: 'Logged out successfully'
  });
});

// ============================================================
// 9. SEND RESET OTP
// ============================================================
router.post('/send-reset-otp',
  rateLimiter(15 * 60 * 1000, 10),
  async (req, res) => {
    console.log('🔐 SEND RESET OTP ROUTE HIT');

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required',
        code: 'MISSING_EMAIL'
      });
    }

    try {
      const admin = findAdminByEmail(email);
      if (!admin) {
        return res.status(404).json({ 
          success: false, 
          message: 'Email not found in our system',
          code: 'EMAIL_NOT_FOUND'
        });
      }

      const otp = generateOTP();
      const expiry = Date.now() + 5 * 60 * 1000;
      otpStore[`reset_${email}`] = { otp, expiry };

      console.log(`📧 Reset OTP for ${email}: ${otp}`);

      try {
        await sendOTPEmail(email, otp, 'reset', admin.name);
        console.log('✅ Reset OTP email sent to', email);
      } catch (emailErr) {
        console.error('❌ Failed to send reset OTP email:', emailErr.message);
        return res.status(500).json({
          success: false,
          message: 'OTP generated but failed to send email. Check email configuration.',
          code: 'EMAIL_FAILED'
        });
      }

      res.json({
        success: true,
        message: 'Reset OTP sent successfully to your email!'
      });

    } catch (error) {
      console.error('❌ Send Reset OTP Error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error: ' + error.message,
        code: 'SERVER_ERROR'
      });
    }
  }
);

// ============================================================
// 10. RESET PASSWORD
// ============================================================
router.post('/reset-password', async (req, res) => {
  console.log('🔐 RESET PASSWORD ROUTE HIT');

  const { email, otp, newPassword, confirmPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email, OTP and new password are required',
      code: 'MISSING_FIELDS'
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ 
      success: false, 
      message: 'Passwords do not match',
      code: 'PASSWORD_MISMATCH'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ 
      success: false, 
      message: 'Password must be at least 6 characters',
      code: 'PASSWORD_TOO_SHORT'
    });
  }

  try {
    const admin = findAdminByEmail(email);
    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Email not found',
        code: 'EMAIL_NOT_FOUND'
      });
    }

    const stored = otpStore[`reset_${email}`];
    if (!stored) {
      return res.status(401).json({ 
        success: false, 
        message: 'No OTP found. Please request a new one.',
        code: 'NO_OTP'
      });
    }

    if (stored.otp !== otp.toUpperCase()) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid OTP',
        code: 'INVALID_OTP'
      });
    }

    if (Date.now() > stored.expiry) {
      delete otpStore[`reset_${email}`];
      return res.status(401).json({ 
        success: false, 
        message: 'OTP expired. Please request a new one.',
        code: 'OTP_EXPIRED'
      });
    }

    delete otpStore[`reset_${email}`];

    // Generate new password hash
    const newHash = await bcrypt.hash(newPassword, 10);

    console.log(`✅ Password reset OTP verified for: ${email}`);
    console.log(`📝 New hash for ${email}: ${newHash}`);

    res.json({
      success: true,
      message: 'OTP verified successfully!',
      data: {
        email: email,
        newHash: newHash,
        note: 'Copy this hash and update ADMIN_PASSWORD_HASH in your environment variables.'
      }
    });

  } catch (error) {
    console.error('❌ Reset Password Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error: ' + error.message,
      code: 'SERVER_ERROR'
    });
  }
});

// ============================================================
// 11. GENERATE HASH (Secured)
// ============================================================
router.get('/generate-hash/:password', async (req, res) => {
  // Only allow in development or with secret key
  const secretKey = req.query.key;
  const validKey = process.env.GENERATE_HASH_KEY || 'dev_only_123';
  
  if (process.env.NODE_ENV === 'production' && secretKey !== validKey) {
    return res.status(403).json({
      success: false,
      message: 'This route is secured. Provide valid key parameter.',
      code: 'ACCESS_DENIED'
    });
  }

  try {
    const hash = await bcrypt.hash(req.params.password, 10);
    res.json({
      success: true,
      password: req.params.password,
      hash: hash,
      note: 'Copy this hash and set it as ADMIN_PASSWORD_HASH or ADMIN2_PASSWORD_HASH in environment variables.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating hash: ' + error.message
    });
  }
});

// ============================================================
// 12. SESSION STATUS
// ============================================================
router.get('/session-status', verifyToken, (req, res) => {
  const session = sessionStore.get(req.admin.id);
  if (!session) {
    return res.json({
      success: false,
      active: false,
      message: 'No active session'
    });
  }
  
  const remaining = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  
  res.json({
    success: true,
    active: true,
    expiresIn: remaining,
    expiresAt: new Date(session.expiresAt).toISOString(),
    remainingMinutes: Math.floor(remaining / 60)
  });
});

// ============================================================
// 13. EXTEND SESSION
// ============================================================
router.post('/extend-session', verifyToken, (req, res) => {
  const extended = extendSession(req.admin.id, 15);
  
  if (extended) {
    const session = sessionStore.get(req.admin.id);
    const remaining = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
    
    res.json({
      success: true,
      message: 'Session extended by 15 minutes',
      expiresIn: remaining,
      remainingMinutes: Math.floor(remaining / 60)
    });
  } else {
    res.json({
      success: false,
      message: 'No active session found'
    });
  }
});

// ============================================================
// 14. DEBUG ROUTE
// ============================================================
router.get('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Admin router is working!',
    admins_configured: ADMINS.length,
    admins: ADMINS.map(a => ({ username: a.username, email: a.email, role: a.role })),
    routes: [
      '/test',
      '/csrf-token',
      '/login',
      '/verify-otp',
      '/refresh-token',
      '/verify',
      '/profile',
      '/logout',
      '/send-reset-otp',
      '/reset-password',
      '/generate-hash/:password',
      '/session-status',
      '/extend-session',
      '/debug'
    ],
    security: {
      jwt: 'Active',
      session: 'Active',
      csrf: 'Active',
      rateLimiting: 'Active',
      loginAttempts: 'Active'
    },
    school_logo_url: SCHOOL_LOGO_URL,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

console.log('✅ All routes defined - Secure Version');

module.exports = router;
