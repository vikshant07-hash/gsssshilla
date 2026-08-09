const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

console.log('🔧 adminRoutes.js loaded!');

// ============================================================
// ADMIN CREDENTIALS - Multiple Admins
// ============================================================
const ADMINS = [
  {
    id: 1,
    username: process.env.ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin',
    email: process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'vikshant07@gmail.com',
    name: process.env.ADMIN_NAME || 'VIKSHANT KRALTA !',
    role: 'Super Admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH
  },
  {
    id: 2,
    username: process.env.ADMIN2_USERNAME,
    email: process.env.ADMIN2_EMAIL,
    name: process.env.ADMIN2_NAME || 'SUJAL KRALTA !',
    role: 'Admin',
    passwordHash: process.env.ADMIN2_PASSWORD_HASH
  }
].filter(admin => admin.username && admin.passwordHash); // Only load admins that are fully configured

if (ADMINS.length === 0) {
  console.warn('⚠️  No admins configured! Set ADMIN1_* and/or ADMIN2_* variables in Render Environment Variables.');
} else {
  console.log(`✅ ${ADMINS.length} admin(s) loaded:`, ADMINS.map(a => a.username).join(', '));
}

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set in .env — using an insecure default. Set it in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

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

// ============================================================
// SCHOOL LOGO URL - FIXED: Environment variable se le rahe hain
// ============================================================
const SCHOOL_LOGO_URL = process.env.SCHOOL_LOGO_URL || 'https://res.cloudinary.com/dwupxj7vf/image/upload/v1786266974/school/recent_updates/update-logo%281%29-1786266967378-883005917.png';

if (!process.env.BREVO_API_KEY) {
  console.warn('⚠️  BREVO_API_KEY not set — OTP emails will fail to send.');
}

// ============================================================
// EMAIL SENDING FUNCTION - COMPLETE UPDATED VERSION
// ============================================================
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

  // ============================================================
  // UPDATED EMAIL TEMPLATE - SCHOOL LOGO NOW WORKING
  // ============================================================
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
            
            <!-- Header with gradient + logo - UPDATED -->
            <tr>
              <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0ea5e9 100%); padding: 32px 24px; text-align:center;">
                <!-- SCHOOL LOGO - NOW USING ENVIRONMENT VARIABLE -->
                <img src="${SCHOOL_LOGO_URL}" alt="GSSS SHILLA Logo" width="72" height="72" style="border-radius:50%; background:#ffffff; padding:6px; margin-bottom:12px; display:inline-block;" />
                <h1 style="color:#ffffff; font-size:22px; margin:8px 0 2px 0; letter-spacing:0.5px;">GSSS SHILLA</h1>
                <p style="color:#e0e7ff; font-size:13px; margin:0;">Government Senior Secondary School Shilla</p>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 32px 28px;">
                <h2 style="color:#1e293b; font-size:19px; margin:0 0 6px 0;">${headingText}</h2>
                <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0 0 20px 0;">
                  Hi ${recipientName}, ${introText}
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
                  ⏱ This OTP is valid for <strong>5 minutes</strong>. If you did not request this, Please ignore this email or contact the school administration.
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
// HELPER - Find admin by username or email
// ============================================================
function findAdminByUsername(username) {
  return ADMINS.find(a => a.username === username);
}

function findAdminByEmail(email) {
  return ADMINS.find(a => a.email === email);
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

    console.log('✅ Login successful:', admin.username);

    res.json({
      success: true,
      message: 'Login successful!',
      token: token,
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

    // NOTE: This route currently verifies the OTP but does not persist the
    // new password anywhere, since passwords live in env variables, not a
    // database. To actually change a password here, you'd need to move
    // credentials into a database (see note below).
    console.log(`✅ Password reset OTP verified for: ${email}`);

    res.json({
      success: true,
      message: 'OTP verified. Note: since credentials are stored in environment variables, generate a new hash for this password using /generate-hash and update the ADMIN_PASSWORD_HASH variable manually on Render.'
    });

  } catch (error) {
    console.error('❌ Reset Password Error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// ============================================================
// 9. GENERATE HASH (TEMPORARY - controlled by env variable)
// ============================================================
// Enable only when needed: set ENABLE_HASH_ROUTE=true in Render env vars,
// generate the hash, then set it back to false (or delete the variable).
router.get('/generate-hash/:password', async (req, res) => {
  if (process.env.ENABLE_HASH_ROUTE !== 'true') {
    return res.status(403).json({ success: false, message: 'This route is disabled' });
  }

  const hash = await bcrypt.hash(req.params.password, 10);
  res.json({ success: true, hash });
});

// ============================================================
// 10. DEBUG ROUTE
// ============================================================
router.get('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Admin router is working!',
    admins_configured: ADMINS.length,
    routes: ['/test', '/login', '/verify-otp', '/verify', '/profile', '/logout', '/send-reset-otp', '/reset-password', '/generate-hash/:password', '/debug'],
    school_logo_url: SCHOOL_LOGO_URL, // Debug mein logo URL bhi show karega
    timestamp: new Date().toISOString()
  });
});

console.log('✅ All routes defined');

// ============================================================
// EXPORT
// ============================================================
module.exports = router;
