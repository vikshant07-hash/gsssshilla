const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

console.log('🔧 adminRoutes.js loaded!');

// ============================================================
// SECURITY MIDDLEWARE - ADDED
// ============================================================

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

// Token Verification Middleware
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

// CSRF Verification Middleware
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
      message: 'Invalid CSRF token',
      code: 'CSRF_INVALID'
    });
  }

  next();
};

// ============================================================
// LOGIN ATTEMPTS STORE (In-Memory)
// ============================================================
const loginAttempts = new Map();

// ============================================================
// CHECK LOGIN ATTEMPTS MIDDLEWARE
// ============================================================
const checkLoginAttempts = (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    let attempt = loginAttempts.get(key);
    
    if (!attempt) {
        attempt = { count: 0, firstAttempt: now, blockUntil: null };
        loginAttempts.set(key, attempt);
    }
    
    // Check if currently blocked
    if (attempt.blockUntil && now < attempt.blockUntil) {
        const remainingHours = Math.ceil((attempt.blockUntil - now) / (60 * 60 * 1000));
        const remainingMinutes = Math.ceil((attempt.blockUntil - now) / (60 * 1000));
        
        let timeMessage = '';
        if (remainingHours >= 1) {
            timeMessage = `${remainingHours} hour${remainingHours > 1 ? 's' : ''}`;
        } else {
            timeMessage = `${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
        }
        
        return res.status(429).json({
            success: false,
            message: `Too many failed attempts. Please try again after ${timeMessage}.`,
            blocked: true,
            blockUntil: attempt.blockUntil,
            remainingMs: attempt.blockUntil - now,
            remainingHours: remainingHours,
            remainingMinutes: remainingMinutes,
            code: 'ACCOUNT_LOCKED'
        });
    }
    
    // Reset after 30 minutes of no activity
    if (now - attempt.firstAttempt > 30 * 60 * 1000) {
        attempt.count = 0;
        attempt.firstAttempt = now;
        attempt.blockUntil = null;
        loginAttempts.set(key, attempt);
    }
    
    req._loginAttempt = attempt;
    next();
};

// ============================================================
// RECORD LOGIN ATTEMPT
// ============================================================
const recordLoginAttempt = (req, success) => {
    const key = req.ip || req.connection.remoteAddress;
    const attempt = req._loginAttempt || loginAttempts.get(key) || { count: 0, firstAttempt: Date.now(), blockUntil: null };
    
    if (success) {
        // Successful login - Reset attempts
        loginAttempts.delete(key);
        return;
    }
    
    // Failed attempt
    attempt.count++;
    attempt.firstAttempt = attempt.firstAttempt || Date.now();
    
    // If 5 failed attempts, block for 12 hours
    if (attempt.count >= 5) {
        attempt.blockUntil = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
        console.log(`🔒 IP ${key} blocked for 12 hours after ${attempt.count} failed attempts`);
    }
    
    loginAttempts.set(key, attempt);
};

// ============================================================
// ADMIN CREDENTIALS - Multiple Admins (YOUR EXISTING CODE)
// ============================================================
const ADMINS = [
  {
    id: 1,
    username: process.env.ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin',
    email: process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'vikshant07@gmail.com',
    name: process.env.ADMIN_NAME || 'VIKSHANT KRALTA',
    role: 'Super Admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH
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
  console.warn('⚠️  No admins configured! Set ADMIN1_* and/or ADMIN2_* variables in Render Environment Variables.');
} else {
  console.log(`✅ ${ADMINS.length} admin(s) loaded:`, ADMINS.map(a => a.username).join(', '));
}

// ============================================================
// SCHOOL LOGO URL - (YOUR EXISTING CODE)
// ============================================================
const SCHOOL_LOGO_URL = process.env.SCHOOL_LOGO_URL || 'https://res.cloudinary.com/dwupxj7vf/image/upload/v1786266974/school/recent_updates/update-logo%281%29-1786266967378-883005917.png';

// ============================================================
// EMAIL SENDING (Brevo) - (YOUR EXISTING CODE)
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
            
            <tr>
              <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%); padding: 32px 24px; text-align:center;">
                <img src="${SCHOOL_LOGO_URL}" alt="GSSS SHILLA" width="82" height="82" style="border-radius:50%; background:#ffffff; padding:6px; margin-bottom:12px; display:inline-block;" />
                <h1 style="color:#ffffff; font-size:22px; margin:8px 0 2px 0; letter-spacing:0.5px;">GSSS SHILLA</h1>
                <p style="color:#e0e7ff; font-size:13px; margin:0;">Government Senior Secondary School Shilla</p>
              </td>
            </tr>

            <tr>
              <td style="padding: 32px 28px;">
                <h2 style="color:#1e293b; font-size:19px; margin:0 0 6px 0;">${headingText}</h2>
                <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 20px 0;">
                  Hi, ${recipientName}! <br>${introText}
                </p>

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
// STORE OTP IN MEMORY - (YOUR EXISTING CODE)
// ============================================================
let otpStore = {};

// ============================================================
// HELPER - Generate OTP - (YOUR EXISTING CODE)
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

// ============================================================
// HELPER - Find admin - (YOUR EXISTING CODE)
// ============================================================
function findAdminByUsername(username) {
  return ADMINS.find(a => a.username === username);
}

function findAdminByEmail(email) {
  return ADMINS.find(a => a.email === email);
}

// ============================================================
// ============================================================
// 1. TEST ROUTE - (YOUR EXISTING CODE)
// ============================================================
router.get('/test', (req, res) => {
  console.log('📥 Test route hit!');
  res.json({ success: true, message: 'Admin routes working!' });
});

// ============================================================
// 2. CSRF TOKEN ROUTE - (NEW)
// ============================================================
router.get('/csrf-token', (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const csrfToken = uuidv4();
  req.session.csrfToken = csrfToken;
  
  res.json({
    success: true,
    token: csrfToken
  });
});

// ============================================================
// 3. LOGIN ROUTE - SEND OTP - (YOUR EXISTING CODE - MODIFIED)
// ============================================================
router.post('/login', async (req, res) => {
  console.log('🔥 LOGIN ROUTE HIT');

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  try {
    const admin = findAdminByUsername(username);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;
    otpStore[username] = { otp, expiry };

    console.log(`📧 OTP for ${username}: ${otp}`);

    try {
      await sendOTPEmail(admin.email, otp, 'login', admin.name);
      console.log('✅ OTP email sent to', admin.email);
    } catch (emailErr) {
      console.error('❌ Failed to send OTP email:', emailErr.message);
      return res.status(500).json({
        success: false,
        message: 'OTP generated but failed to send email. Check email configuration.'
      });
    }

    // Generate CSRF token for the session
    const { v4: uuidv4 } = require('uuid');
    req.session.csrfToken = uuidv4();

    res.json({
      success: true,
      message: 'OTP sent successfully to your email!'
    });

  } catch (error) {
    console.error('❌ Login Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// ============================================================
// 4. VERIFY OTP ROUTE - (YOUR EXISTING CODE - MODIFIED)
// ============================================================
router.post('/verify-otp', async (req, res) => {
  console.log('🔥 VERIFY OTP ROUTE HIT');

  const { username, password, otp } = req.body;

  if (!username || !password || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Username, password and OTP are required'
    });
  }

  try {
    const admin = findAdminByUsername(username);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const stored = otpStore[username];
    if (!stored) {
      return res.status(401).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (stored.otp !== otp.toUpperCase()) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    if (Date.now() > stored.expiry) {
      delete otpStore[username];
      return res.status(401).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    delete otpStore[username];

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

    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: admin.id },
      process.env.JWT_REFRESH_SECRET || JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Generate CSRF token
    const { v4: uuidv4 } = require('uuid');
    const csrfToken = uuidv4();
    req.session.csrfToken = csrfToken;

    console.log('✅ Login successful:', admin.username);

    res.json({
      success: true,
      message: 'Login successful!',
      token: token,
      refreshToken: refreshToken,
      csrfToken: csrfToken,
      data: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('❌ Verify OTP Error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// ============================================================
// 5. REFRESH TOKEN ROUTE - (NEW)
// ============================================================
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: 'Refresh token required'
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || JWT_SECRET);
    
    const admin = ADMINS.find(a => a.id === decoded.id);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

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
      process.env.JWT_REFRESH_SECRET || JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { v4: uuidv4 } = require('uuid');
    const csrfToken = uuidv4();
    req.session.csrfToken = csrfToken;

    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken,
      csrfToken: csrfToken
    });

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
});

// ============================================================
// 6. VERIFY ROUTE - (YOUR EXISTING CODE - MODIFIED)
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  res.json({ success: true, admin: req.admin, message: 'Token is valid' });
});

// ============================================================
// 7. PROFILE ROUTE - (YOUR EXISTING CODE - MODIFIED)
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
      last_login: new Date().toISOString()
    }
  });
});

// ============================================================
// 8. LOGOUT ROUTE - (YOUR EXISTING CODE - MODIFIED)
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  // Clear session
  req.session.destroy();
  
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
});

// ============================================================
// 9. EXTEND SESSION - (NEW)
// ============================================================
router.post('/extend-session', verifyToken, (req, res) => {
  res.json({
    success: true,
    message: 'Session extended',
    expiresIn: 30 * 60 // 30 minutes
  });
});

// ============================================================
// 10. SEND RESET OTP - (YOUR EXISTING CODE)
// ============================================================
router.post('/send-reset-otp', async (req, res) => {
  console.log('🔥 SEND RESET OTP ROUTE HIT');

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    const admin = findAdminByEmail(email);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Email not found in our system' });
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
        message: 'OTP generated but failed to send email. Check email configuration.'
      });
    }

    res.json({
      success: true,
      message: 'Reset OTP sent successfully to your email!'
    });

  } catch (error) {
    console.error('❌ Send Reset OTP Error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// ============================================================
// 11. RESET PASSWORD - (YOUR EXISTING CODE)
// ============================================================
router.post('/reset-password', async (req, res) => {
  console.log('🔥 RESET PASSWORD ROUTE HIT');

  const { email, otp, newPassword, confirmPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email, OTP and new password are required' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Passwords do not match' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  try {
    const admin = findAdminByEmail(email);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Email not found' });
    }

    const stored = otpStore[`reset_${email}`];
    if (!stored) {
      return res.status(401).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (stored.otp !== otp.toUpperCase()) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    if (Date.now() > stored.expiry) {
      delete otpStore[`reset_${email}`];
      return res.status(401).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    delete otpStore[`reset_${email}`];

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
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// ============================================================
// 12. GENERATE HASH - (YOUR EXISTING CODE)
// ============================================================
router.get('/generate-hash/:password', async (req, res) => {
  if (process.env.ENABLE_HASH_ROUTE !== 'true') {
    return res.status(403).json({ success: false, message: 'This route is disabled' });
  }

  const hash = await bcrypt.hash(req.params.password, 10);
  res.json({ success: true, hash });
});

// ============================================================
// 13. SESSION STATUS - (NEW)
// ============================================================
router.get('/session-status', verifyToken, (req, res) => {
  res.json({
    success: true,
    active: true,
    expiresIn: 30 * 60, // 30 minutes
    remainingMinutes: 30
  });
});

// ============================================================
// 14. DEBUG ROUTE - (YOUR EXISTING CODE - MODIFIED)
// ============================================================
router.get('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Admin router is working!',
    admins_configured: ADMINS.length,
    routes: ['/test', '/csrf-token', '/login', '/verify-otp', '/refresh-token', '/verify', '/profile', '/logout', '/extend-session', '/send-reset-otp', '/reset-password', '/generate-hash/:password', '/session-status', '/debug'],
    security: {
      jwt: 'Active',
      session: 'Active',
      csrf: 'Active',
      rateLimiting: 'Active (via server.js)'
    },
    school_logo_url: SCHOOL_LOGO_URL,
    timestamp: new Date().toISOString()
  });
});

console.log('✅ All routes defined');

// ============================================================
// EXPORT
// ============================================================
module.exports = router;
