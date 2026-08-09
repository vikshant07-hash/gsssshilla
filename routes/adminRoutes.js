const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

console.log('🔧 adminRoutes.js loaded!');

// ============================================================
// ADMIN CREDENTIALS
// ============================================================
const ADMIN = {
  id: 1,
  username: process.env.ADMIN_USERNAME || 'admin',
  email: process.env.ADMIN_EMAIL || 'vikshant07@gmail.com',
  name: 'Admin User',
  role: 'Super Admin'
};

if (!process.env.ADMIN_PASSWORD_HASH) {
  console.warn('⚠️  ADMIN_PASSWORD_HASH not set in .env — set it in Render Environment Variables.');
}
const HASHED_PASSWORD = process.env.ADMIN_PASSWORD_HASH;

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set in .env — using an insecure default. Set it in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

console.log('✅ Admin credentials loaded');

// ============================================================
// EMAIL SENDING (Brevo Transactional Email API)
// ============================================================
// Requires this Render Environment Variable:
//   BREVO_API_KEY = <your Brevo API key (starts with xkeysib-...)>
//
// IMPORTANT: magicalmathsquiz@gmail.com must be a VERIFIED sender
// in your Brevo account (Senders, Domains & Dedicated IPs → Senders)
// or Brevo will reject the send.
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'magicalmathsquiz@gmail.com';
const BREVO_SENDER_NAME = 'GSSS SHILLA';

if (!process.env.BREVO_API_KEY) {
  console.warn('⚠️  BREVO_API_KEY not set — OTP emails will fail to send.');
}

async function sendOTPEmail(toEmail, otp, purpose = 'login') {
  const subjectText = purpose === 'reset'
    ? 'Password Reset OTP — GSSS SHILLA'
    : 'Admin Login OTP — GSSS SHILLA';

  const headingText = purpose === 'reset'
    ? 'Password Reset Request'
    : 'Admin Login Verification';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 10px;">
      <h2 style="color: #1f2937; margin-bottom: 4px;">GSSS SHILLA</h2>
      <p style="color: #6b7280; margin-top: 0;">${headingText}</p>
      <p style="font-size: 15px; color: #374151;">Your One-Time Password (OTP) is:</p>
      <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; background: #f3f4f6; padding: 14px; text-align: center; border-radius: 8px; color: #111827;">
        ${otp}
      </div>
      <p style="font-size: 13px; color: #9ca3af; margin-top: 18px;">
        This OTP is valid for 5 minutes. If you did not request this, please ignore this email.
      </p>
    </div>
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
// VERIFY TOKEN
// ============================================================
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ============================================================
// STORE OTP IN MEMORY
// ============================================================
let otpStore = {};

// ============================================================
// HELPER - Generate OTP
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
// 1. TEST ROUTE
// ============================================================
router.get('/test', (req, res) => {
  console.log('📥 Test route hit!');
  res.json({ success: true, message: 'Admin routes working!' });
});

// ============================================================
// 2. LOGIN ROUTE - SEND OTP
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
    if (username !== ADMIN.username) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const isMatch = await bcrypt.compare(password, HASHED_PASSWORD);
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
      await sendOTPEmail(ADMIN.email, otp, 'login');
      console.log('✅ OTP email sent to', ADMIN.email);
    } catch (emailErr) {
      console.error('❌ Failed to send OTP email:', emailErr.message);
      return res.status(500).json({
        success: false,
        message: 'OTP generated but failed to send email. Check email configuration.'
      });
    }

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
// 3. VERIFY OTP ROUTE
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
    if (username !== ADMIN.username) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, HASHED_PASSWORD);
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
        id: ADMIN.id,
        username: ADMIN.username,
        email: ADMIN.email,
        name: ADMIN.name,
        role: ADMIN.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login successful:', ADMIN.username);

    res.json({
      success: true,
      message: 'Login successful!',
      token: token,
      data: {
        id: ADMIN.id,
        username: ADMIN.username,
        email: ADMIN.email,
        name: ADMIN.name,
        role: ADMIN.role
      }
    });

  } catch (error) {
    console.error('❌ Verify OTP Error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// ============================================================
// 4. VERIFY ROUTE
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  res.json({ success: true, admin: req.admin, message: 'Token is valid' });
});

// ============================================================
// 5. PROFILE ROUTE
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
// 6. LOGOUT ROUTE
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================================
// 7. SEND RESET OTP
// ============================================================
router.post('/send-reset-otp', async (req, res) => {
  console.log('🔥 SEND RESET OTP ROUTE HIT');

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    if (email !== ADMIN.email) {
      return res.status(404).json({ success: false, message: 'Email not found in our system' });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;
    otpStore[`reset_${email}`] = { otp, expiry };

    console.log(`📧 Reset OTP for ${email}: ${otp}`);

    try {
      await sendOTPEmail(email, otp, 'reset');
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
// 8. RESET PASSWORD
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
    if (email !== ADMIN.email) {
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

    console.log(`✅ Password reset OTP verified for: ${email}`);

    res.json({ success: true, message: 'Password reset successfully!' });

  } catch (error) {
    console.error('❌ Reset Password Error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// TEMPORARY - remove before deploying / after use
router.post('/generate-hash', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }
  const hash = await bcrypt.hash(password, 10);
  res.json({ success: true, hash });
});

// ============================================================
// 9. DEBUG ROUTE
// ============================================================
router.get('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Admin router is working!',
    routes: ['/test', '/login', '/verify-otp', '/verify', '/profile', '/logout', '/send-reset-otp', '/reset-password', '/debug'],
    timestamp: new Date().toISOString()
  });
});

console.log('✅ All routes defined');

// ============================================================
// EXPORT
// ============================================================
module.exports = router;
