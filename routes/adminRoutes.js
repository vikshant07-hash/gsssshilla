const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

console.log('🔧 adminRoutes.js loaded!');

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

const verifyToken = (req, res, next) => {
  console.log('🛡️ verifyToken middleware called for:', req.method, req.path);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No token provided for:', req.path);
      return res.status(401).json({
        success: false,
        message: 'No token provided',
        code: 'NO_TOKEN'
      });
    }
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
// LOGIN ATTEMPTS
// ============================================================
const loginAttempts = new Map();

const checkLoginAttempts = (req, res, next) => {
    const { username } = req.body;
    if (!username) return next();

    const key = `user_${username}`;
    const now = Date.now();
    let attempt = loginAttempts.get(key);

    if (!attempt) {
        attempt = { count: 0, firstAttempt: now, blockUntil: null };
        loginAttempts.set(key, attempt);
    }

    if (attempt.blockUntil && now < attempt.blockUntil) {
        const remainingMs = attempt.blockUntil - now;
        const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
        const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
        const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));

        let timeMessage = '';
        if (remainingDays >= 1) {
            const hrs = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
            timeMessage = `${remainingDays} day${remainingDays > 1 ? 's' : ''}${hrs > 0 ? ` ${hrs} hour${hrs > 1 ? 's' : ''}` : ''}`;
        } else if (remainingHours >= 1) {
            const mins = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
            timeMessage = `${remainingHours} hour${remainingHours > 1 ? 's' : ''}${mins > 0 ? ` ${mins} minute${mins > 1 ? 's' : ''}` : ''}`;
        } else if (remainingMinutes >= 1) {
            timeMessage = `${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
        } else {
            timeMessage = 'just a few seconds';
        }

        return res.status(429).json({
            success: false,
            message: `Too many failed attempts. Please try again after ${timeMessage}.`,
            blocked: true,
            blockUntil: attempt.blockUntil,
            code: 'ACCOUNT_LOCKED'
        });
    }

    if (now - attempt.firstAttempt > 30 * 60 * 1000) {
        attempt.count = 0;
        attempt.firstAttempt = now;
        attempt.blockUntil = null;
        loginAttempts.set(key, attempt);
    }

    req._loginAttempt = attempt;
    req._loginKey = key;
    next();
};

const recordLoginAttempt = (req, success, username) => {
    const user = username || req.body?.username;
    if (!user) return;

    const key = `user_${user}`;
    const attempt = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now(), blockUntil: null };

    if (success) {
        loginAttempts.delete(key);
        console.log(`✅ Login successful for ${user}`);
        return;
    }

    attempt.count++;
    attempt.firstAttempt = attempt.firstAttempt || Date.now();

    if (attempt.count >= 5) {
        attempt.blockUntil = Date.now() + 12 * 60 * 60 * 1000;
        console.log(`🔒 User "${user}" blocked for 12 hours`);
    }

    loginAttempts.set(key, attempt);
    console.log(`❌ Failed login for "${user}" (${attempt.count}/5)`);
};

// ============================================================
// ADMIN CREDENTIALS
// ============================================================
// NOTE: this array lives in memory. On a server restart it resets back
// to whatever ADMIN_PASSWORD_HASH / ADMIN2_PASSWORD_HASH are set to in
// the environment. See FIX #2 (reset-password route) below for how a
// runtime password change is applied to this array so login actually
// picks up the new password without needing an env var / redeploy.
const ADMINS = [
  {
    id: 1,
    username: process.env.ADMIN_USERNAME || 'admin@shilla171210',
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

// ============================================================
// EMAIL SENDING
// ============================================================
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'magicalmathsquiz@gmail.com';
const BREVO_SENDER_NAME = 'GSSS SHILLA';
const SCHOOL_LOGO_URL = process.env.SCHOOL_LOGO_URL || 'https://res.cloudinary.com/dwupxj7vf/image/upload/v1786266974/school/recent_updates/update-logo%281%29-1786266967378-883005917.png';

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

  // FIX #1 (root cause of the "email arrives but empty" bug):
  // The previous template opened <body> but never closed it before
  // </html> — several mail clients (Outlook's Word rendering engine,
  // some corporate scanners, and Brevo's own HTML sanitizer) treat
  // malformed/unclosed markup as invalid and render a blank body
  // instead of failing loudly. Switched to the standard XHTML
  // Transitional doctype used for HTML emails (much more reliably
  // supported across clients than the plain HTML5 doctype) and made
  // sure every tag opened is explicitly closed.
  const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subjectText}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family: 'Segoe UI', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f9" style="background-color:#f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:520px; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow: 0 4px 18px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#4f46e5; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%); padding: 32px 24px; text-align:center;">
              <img src="${SCHOOL_LOGO_URL}" alt="GSSS SHILLA" width="82" height="82" style="border-radius:50%; background:#ffffff; padding:6px; margin-bottom:12px; display:inline-block;" />
              <h1 style="color:#ffffff; font-size:22px; margin:8px 0 2px 0; letter-spacing:0.5px;">GSSS SHILLA</h1>
              <p style="color:#e0e7ff; font-size:13px; margin:0;">Government Senior Secondary School Shilla</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 28px;">
              <h2 style="color:#1e293b; font-size:19px; margin:0 0 6px 0;">${headingText}</h2>
              <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 20px 0;">
                Hi, ${recipientName}! <br />${introText}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#eef2ff" style="background-color:#eef2ff; background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%); border: 1.5px dashed #6366f1; border-radius: 12px; padding: 20px;">
                    <p style="margin:0 0 8px 0; color:#6366f1; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:1px;">Your OTP Code</p>
                    <div style="font-size:32px; font-weight:800; letter-spacing:8px; color:#1e1b4b;">${otp}</div>
                  </td>
                </tr>
              </table>
              <p style="color:#94a3b8; font-size:12.5px; line-height:1.6; margin:20px 0 0 0;">
                ⏱ This OTP is valid for <strong>5 minutes</strong>. <br /> <strong>Note:</strong> If you did not request this, please ignore this email or contact the school administration.
              </p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#f8fafc" style="background:#f8fafc; padding: 18px 24px; text-align:center; border-top:1px solid #e2e8f0;">
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
</html>`;

  // Plain-text fallback so clients/spam filters that can't (or won't)
  // render the HTML part still show the OTP instead of a blank email.
  const textContent = `${headingText}\n\nHi, ${recipientName}!\n${introText}\n\nYour OTP Code: ${otp}\n\nThis OTP is valid for 5 minutes.\nIf you did not request this, please ignore this email or contact the school administration.\n\n© ${new Date().getFullYear()} GSSS SHILLA`;

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
      htmlContent: htmlContent,
      textContent: textContent
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

// ============================================================
// STORE OTP
// ============================================================
let otpStore = {};

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
// 🔓 PUBLIC ROUTES - NO TOKEN REQUIRED (DEFINED FIRST)
// ============================================================
console.log('🔓 Registering PUBLIC routes...');

// 1. Test Route
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Admin routes working!' });
});

// 2. CSRF Token
router.get('/csrf-token', (req, res) => {
  const csrfToken = uuidv4();
  req.session.csrfToken = csrfToken;
  res.json({ success: true, token: csrfToken });
});

// 3. LOGIN - Public
router.post('/login', checkLoginAttempts, async (req, res) => {
  console.log('🔥 LOGIN ROUTE HIT - PUBLIC');
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
      recordLoginAttempt(req, false, username);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      recordLoginAttempt(req, false, username);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS'
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
        message: 'OTP generated but failed to send email. Check email configuration.',
        code: 'EMAIL_FAILED'
      });
    }

    recordLoginAttempt(req, true, username);

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
});

// 4. VERIFY OTP - PUBLIC (NO TOKEN REQUIRED) ✅✅✅
router.post('/verify-otp', async (req, res) => {
  console.log('🔥 VERIFY OTP ROUTE HIT - PUBLIC ✅');

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

    // ✅ Generate JWT Token
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

    const refreshToken = jwt.sign(
      { id: admin.id },
      process.env.JWT_REFRESH_SECRET || JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ Login successful:', admin.username);

    res.json({
      success: true,
      message: 'Login successful!',
      token: token,
      refreshToken: refreshToken,
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
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
      code: 'SERVER_ERROR'
    });
  }
});

// 5. Refresh Token - Public
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
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || JWT_SECRET);
    const admin = ADMINS.find(a => a.id === decoded.id);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
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

    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken
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

// 6. Send Reset OTP - Public
router.post('/send-reset-otp', async (req, res) => {
  console.log('🔥 SEND RESET OTP ROUTE HIT - PUBLIC');

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
});

// 7. Reset Password - Public
router.post('/reset-password', async (req, res) => {
  console.log('🔥 RESET PASSWORD ROUTE HIT - PUBLIC');

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

    const newHash = await bcrypt.hash(newPassword, 10);

    // FIX #2: previously this route generated a new hash and just
    // returned it in the response, expecting someone to manually copy
    // it into ADMIN_PASSWORD_HASH and redeploy — meaning the "reset"
    // never actually took effect and the old password kept working.
    // Now the in-memory ADMINS record is updated immediately, so the
    // new password works right away for /login.
    // NOTE: this is still in-memory only — it will revert to the env
    // var value on a server restart/redeploy. For a permanent reset,
    // also update ADMIN_PASSWORD_HASH / ADMIN2_PASSWORD_HASH with the
    // hash below in your environment variables.
    admin.passwordHash = newHash;
    console.log(`✅ Password reset applied for: ${email} (in-memory — update env var for permanence)`);

    res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
      data: {
        email: email,
        newHash: newHash,
        note: 'Password updated for this running server. To make it permanent across restarts, also update ADMIN_PASSWORD_HASH in your environment variables with this hash.'
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

// 8. Verify Token - Public (Checks token but doesn't require it)
router.get('/verify', (req, res) => {
  console.log('🔓 VERIFY ROUTE HIT - PUBLIC');
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
    const admin = ADMINS.find(a => a.id === decoded.id);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        name: admin.name,
        role: admin.role
      },
      message: 'Token is valid',
      code: 'TOKEN_VALID'
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message,
      code: 'SERVER_ERROR'
    });
  }
});

// 9. Generate Hash - Public (If enabled)
router.get('/generate-hash/:password', async (req, res) => {
  if (process.env.ENABLE_HASH_ROUTE !== 'true') {
    return res.status(403).json({
      success: false,
      message: 'This route is disabled',
      code: 'ACCESS_DENIED'
    });
  }

  try {
    const hash = await bcrypt.hash(req.params.password, 10);
    res.json({
      success: true,
      password: req.params.password,
      hash: hash
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating hash: ' + error.message
    });
  }
});

// ============================================================
// 🛡️ PROTECTED ROUTES - TOKEN REQUIRED
// ============================================================
console.log('🛡️ Registering PROTECTED routes...');
router.use(verifyToken);

// 10. Profile - Protected
router.get('/profile', (req, res) => {
  console.log('🔒 PROFILE ROUTE HIT - PROTECTED');
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

// 11. Logout - Protected
router.post('/logout', (req, res) => {
  console.log('🔒 LOGOUT ROUTE HIT - PROTECTED');
  if (req.session) {
    req.session.destroy();
  }
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// 12. Extend Session - Protected
router.post('/extend-session', (req, res) => {
  console.log('🔒 EXTEND SESSION ROUTE HIT - PROTECTED');
  res.json({
    success: true,
    message: 'Session extended',
    expiresIn: 30 * 60
  });
});

// 13. Session Status - Protected
router.get('/session-status', (req, res) => {
  console.log('🔒 SESSION STATUS ROUTE HIT - PROTECTED');
  res.json({
    success: true,
    active: true,
    expiresIn: 30 * 60,
    remainingMinutes: 30
  });
});

// 14. Login Status - Protected
router.get('/login-status', (req, res) => {
  console.log('🔒 LOGIN STATUS ROUTE HIT - PROTECTED');
  const { username } = req.query;

  if (username) {
    const key = `user_${username}`;
    const attempt = loginAttempts.get(key);

    if (!attempt) {
      return res.json({
        success: true,
        username: username,
        attempts: 0,
        blocked: false
      });
    }

    const now = Date.now();
    const isBlocked = attempt.blockUntil && now < attempt.blockUntil;

    if (isBlocked) {
      const remainingMs = attempt.blockUntil - now;
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));

      let timeMessage = '';
      if (remainingHours >= 1) {
        const mins = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
        timeMessage = `${remainingHours}h ${mins}m`;
      } else {
        timeMessage = `${remainingMinutes}m`;
      }

      return res.json({
        success: true,
        username: username,
        attempts: attempt.count,
        blocked: true,
        timeMessage: timeMessage,
        message: `Account locked. Try again after ${timeMessage}.`
      });
    }

    return res.json({
      success: true,
      username: username,
      attempts: attempt.count,
      blocked: false
    });
  }

  const allUsers = [];
  for (const [key, value] of loginAttempts) {
    const user = key.replace('user_', '');
    const now = Date.now();
    const isBlocked = value.blockUntil && now < value.blockUntil;

    allUsers.push({
      username: user,
      attempts: value.count,
      blocked: isBlocked,
      blockUntil: value.blockUntil
    });
  }

  res.json({
    success: true,
    totalUsers: allUsers.length,
    users: allUsers
  });
});

// 15. Clear Attempts - Protected (Super Admin only)
router.delete('/clear-attempts/:username', (req, res) => {
  console.log('🔒 CLEAR ATTEMPTS ROUTE HIT - PROTECTED');
  const { username } = req.params;

  if (req.admin.role !== 'Super Admin') {
    return res.status(403).json({
      success: false,
      message: 'Only Super Admin can clear login attempts',
      code: 'ACCESS_DENIED'
    });
  }

  const key = `user_${username}`;
  if (loginAttempts.has(key)) {
    loginAttempts.delete(key);
    res.json({
      success: true,
      message: `Login attempts cleared for user: ${username}`
    });
  } else {
    res.json({
      success: true,
      message: `No attempts found for user: ${username}`
    });
  }
});

// 16. Debug - Protected
router.get('/debug', (req, res) => {
  console.log('🔒 DEBUG ROUTE HIT - PROTECTED');
  res.json({
    success: true,
    message: 'Admin router is working!',
    admins_configured: ADMINS.length,
    admins: ADMINS.map(a => ({ username: a.username, email: a.email, role: a.role })),
    routes: {
      public: ['/test', '/csrf-token', '/login', '/verify-otp', '/refresh-token', '/verify', '/send-reset-otp', '/reset-password', '/generate-hash/:password'],
      protected: ['/profile', '/logout', '/extend-session', '/session-status', '/login-status', '/clear-attempts/:username', '/debug']
    },
    security: {
      jwt: 'Active',
      session: 'Active',
      loginAttempts: '5 attempts per user, 12 hours block'
    },
    loginAttemptsCount: loginAttempts.size,
    timestamp: new Date().toISOString()
  });
});

// 17. Force Clear - Protected
router.get('/force-clear/:username', (req, res) => {
  console.log('🔒 FORCE CLEAR ROUTE HIT - PROTECTED');
    const { username } = req.params;

    if (username === 'all') {
        const count = loginAttempts.size;
        loginAttempts.clear();
        return res.json({
            success: true,
            message: `✅ Cleared all ${count} login attempts`
        });
    }

    const key = `user_${username}`;
    if (loginAttempts.has(key)) {
        loginAttempts.delete(key);
        return res.json({
            success: true,
            message: `✅ Cleared login attempts for: ${username}`
        });
    }

    res.json({
        success: true,
        message: `ℹ️ No attempts found for: ${username}`
    });
});

// 18. Blocked Users - Protected
router.get('/blocked-users', (req, res) => {
  console.log('🔒 BLOCKED USERS ROUTE HIT - PROTECTED');
    const blocked = [];
    const now = Date.now();

    for (const [key, value] of loginAttempts) {
        if (value.blockUntil && now < value.blockUntil) {
            const username = key.replace('user_', '');
            const remainingMs = value.blockUntil - now;
            const minutes = Math.ceil(remainingMs / (60 * 1000));
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;

            let timeStr = '';
            if (hours > 0) {
                timeStr = `${hours}h ${mins}m`;
            } else {
                timeStr = `${mins}m`;
            }

            blocked.push({
                username: username,
                attempts: value.count,
                remainingTime: timeStr,
                blockUntil: value.blockUntil
            });
        }
    }

    res.json({
        success: true,
        blockedUsers: blocked,
        totalBlocked: blocked.length
    });
});

console.log('✅ All routes registered successfully!');
console.log('🔓 Public routes: /login, /verify-otp, /refresh-token, /send-reset-otp, /reset-password, /verify');
console.log('🛡️ Protected routes: /profile, /logout, /extend-session, /session-status, /login-status, /clear-attempts/:username, /debug');

module.exports = router;
