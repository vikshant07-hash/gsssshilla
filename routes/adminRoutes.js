const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ============================================================
// DATABASE CONNECTION
// ============================================================
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'school_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

// ============================================================
// RATE LIMITING
// ============================================================
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many OTP requests. Try after 15 minutes.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try after 15 minutes.' }
});

// ============================================================
// JWT VERIFY FUNCTION
// ============================================================
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    req.admin = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid token.'
    });
  }
}

// ============================================================
// EMAIL FUNCTIONS
// ============================================================
async function sendEmail(to, otp, title, type = "login") {
  try {
    let template = '';
    if (type === "login") {
      template = getLoginOTPTemplate(otp, title);
    } else if (type === "reset") {
      template = getResetOTPTemplate(otp, title);
    }

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "Govt. Sr. Sec. School Shilla",
          email: process.env.BREVO_SENDER_EMAIL || 'noreply@gsssshilla.com'
        },
        to: [{ email: to }],
        subject: title,
        htmlContent: template
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );
    return true;
  } catch (err) {
    console.error("❌ BREVO ERROR:", err.response?.data || err.message);
    return false;
  }
}

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
// EMAIL TEMPLATES
// ============================================================
function getLoginOTPTemplate(otp, title) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Segoe UI',Arial,sans-serif;background:#0b1220;}
      .container{max-width:600px;margin:0 auto;padding:40px 20px;background:#0b1220;}
      .card{background:linear-gradient(145deg,#111827,#1a2332);padding:40px;border-radius:16px;border:1px solid #2a3a5a;box-shadow:0 20px 60px rgba(0,0,0,0.5);}
      .header{text-align:center;margin-bottom:30px;}
      .header .icon{font-size:48px;margin-bottom:10px;}
      .header h1{color:#ffffff;font-size:24px;font-weight:700;}
      .header p{color:#94a3b8;font-size:14px;margin-top:5px;}
      .divider{height:2px;background:linear-gradient(90deg,transparent,#ce0c9d,transparent);margin:20px 0;}
      .title{color:#ffffff;font-size:20px;text-align:center;margin:20px 0 10px;}
      .otp-box{background:#0f172a;border:2px dashed #ce0c9d;border-radius:12px;padding:25px;margin:25px 0;text-align:center;}
      .otp-box .otp{font-size:36px;letter-spacing:8px;font-weight:bold;color:#facc15;font-family:'Courier New',monospace;}
      .info{text-align:center;color:#94a3b8;font-size:14px;line-height:1.6;}
      .info span{color:#facc15;font-weight:bold;}
      .footer{margin-top:30px;padding-top:20px;border-top:1px solid #1e293b;text-align:center;font-size:12px;color:#475569;}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="icon">🏫</div>
          <h1>Govt. Sr. Sec. School Shilla</h1>
          <p>Himachal Pradesh</p>
        </div>
        <div class="divider"></div>
        <h2 class="title">${title}</h2>
        <div class="otp-box">
          <div class="otp">${otp}</div>
        </div>
        <div class="info">
          <p>⏱️ Valid for <span>5 minutes</span></p>
          <p>🔒 Do not share this OTP with anyone</p>
        </div>
        <div class="footer">
          <p>Automated message from School Management System</p>
          <p>© ${new Date().getFullYear()} Govt. Sr. Sec. School Shilla</p>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

function getResetOTPTemplate(otp, title) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Segoe UI',Arial,sans-serif;background:#0b1220;}
      .container{max-width:600px;margin:0 auto;padding:40px 20px;background:#0b1220;}
      .card{background:linear-gradient(145deg,#111827,#1a2332);padding:40px;border-radius:16px;border:1px solid #2a3a5a;box-shadow:0 20px 60px rgba(0,0,0,0.5);}
      .header{text-align:center;margin-bottom:30px;}
      .header .icon{font-size:48px;margin-bottom:10px;}
      .header h1{color:#ffffff;font-size:24px;font-weight:700;}
      .header p{color:#94a3b8;font-size:14px;margin-top:5px;}
      .divider{height:2px;background:linear-gradient(90deg,transparent,#facc15,transparent);margin:20px 0;}
      .title{color:#ffffff;font-size:20px;text-align:center;margin:20px 0 10px;}
      .otp-box{background:#0f172a;border:2px dashed #facc15;border-radius:12px;padding:25px;margin:25px 0;text-align:center;}
      .otp-box .otp{font-size:36px;letter-spacing:8px;font-weight:bold;color:#facc15;font-family:'Courier New',monospace;}
      .info{text-align:center;color:#94a3b8;font-size:14px;line-height:1.6;}
      .info span{color:#facc15;font-weight:bold;}
      .warning{text-align:center;color:#f87171;font-size:13px;margin-top:10px;}
      .footer{margin-top:30px;padding-top:20px;border-top:1px solid #1e293b;text-align:center;font-size:12px;color:#475569;}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="icon">🔐</div>
          <h1>Password Reset Request</h1>
          <p>Govt. Sr. Sec. School Shilla</p>
        </div>
        <div class="divider"></div>
        <h2 class="title">${title}</h2>
        <div class="otp-box">
          <div class="otp">${otp}</div>
        </div>
        <div class="info">
          <p>⏱️ Valid for <span>5 minutes</span></p>
          <p>🔒 Do not share this OTP with anyone</p>
        </div>
        <div class="warning">⚠️ If you didn't request this, please ignore this email</div>
        <div class="footer">
          <p>Automated message from School Management System</p>
          <p>© ${new Date().getFullYear()} Govt. Sr. Sec. School Shilla</p>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

// ============================================================
// ==================== API ROUTES ============================
// ============================================================

// ============================================================
// 1. SEND OTP FOR LOGIN
// ============================================================
router.post('/send-otp', otpLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  try {
    const [users] = await db.query(
      'SELECT * FROM admins WHERE username = ?',
      [username]
    );

    if (!users.length) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Account deactivated. Contact admin.'
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;

    await db.query(
      'UPDATE admins SET otp = ?, otp_expiry = ? WHERE id = ?',
      [otp, expiry, user.id]
    );

    const sent = await sendEmail(user.email, otp, 'ADMIN LOGIN OTP', 'login');

    if (!sent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.'
      });
    }

    console.log(`✅ OTP sent to: ${user.email}`);

    res.json({
      success: true,
      message: 'OTP sent successfully to your registered email'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
});

// ============================================================
// 2. LOGIN WITH OTP
// ============================================================
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, otp } = req.body;

  if (!username || !password || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Username, password and OTP are required'
    });
  }

  try {
    const [users] = await db.query(
      'SELECT * FROM admins WHERE username = ?',
      [username]
    );

    if (!users.length) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Account deactivated. Contact admin.'
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!user.otp || user.otp.toUpperCase() !== otp.toUpperCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (Date.now() > user.otp_expiry) {
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Request a new one.'
      });
    }

    await db.query(
      'UPDATE admins SET otp = NULL, otp_expiry = NULL, last_login = NOW() WHERE id = ?',
      [user.id]
    );

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || 'admin'
      },
      process.env.JWT_SECRET || 'your_secret_key',
      { expiresIn: process.env.JWT_EXPIRY || '3h' }
    );

    console.log(`✅ Admin logged in: ${user.username}`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || 'admin'
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
});

// ============================================================
// 3. SEND RESET OTP
// ============================================================
router.post('/send-reset-otp', otpLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }

  try {
    const [admins] = await db.query(
      'SELECT * FROM admins WHERE email = ?',
      [email]
    );

    if (!admins.length) {
      return res.status(404).json({
        success: false,
        message: 'Email not found in our system'
      });
    }

    const admin = admins[0];

    if (admin.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Account deactivated. Contact admin.'
      });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;

    await db.query(
      'UPDATE admins SET otp = ?, otp_expiry = ? WHERE id = ?',
      [otp, expiry, admin.id]
    );

    const sent = await sendEmail(admin.email, otp, 'PASSWORD RESET OTP', 'reset');

    if (!sent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP. Please try again.'
      });
    }

    console.log(`✅ Reset OTP sent to: ${admin.email}`);

    res.json({
      success: true,
      message: 'Reset OTP sent successfully to your email'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
});

// ============================================================
// 4. RESET PASSWORD
// ============================================================
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword, confirmPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Email, OTP and new password are required'
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: 'Passwords do not match'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });
  }

  try {
    const [admins] = await db.query(
      'SELECT * FROM admins WHERE email = ?',
      [email]
    );

    if (!admins.length) {
      return res.status(404).json({
        success: false,
        message: 'Email not found'
      });
    }

    const admin = admins[0];

    if (!admin.otp || admin.otp.toUpperCase() !== otp.toUpperCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (Date.now() > admin.otp_expiry) {
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Request a new one.'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      'UPDATE admins SET password = ?, otp = NULL, otp_expiry = NULL, updated_at = NOW() WHERE id = ?',
      [hashedPassword, admin.id]
    );

    console.log(`✅ Password reset for: ${admin.email}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
});

// ============================================================
// 5. VERIFY ADMIN TOKEN
// ============================================================
router.get('/verify-admin', verifyToken, async (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
    message: 'Token is valid'
  });
});

// ============================================================
// 6. GET ADMIN PROFILE
// ============================================================
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const [admins] = await db.query(
      'SELECT id, username, email, role, status, last_login, created_at FROM admins WHERE id = ?',
      [req.admin.id]
    );

    if (!admins.length) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      data: admins[0]
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
});

// ============================================================
// 7. LOGOUT
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  console.log(`🔓 Admin logged out: ${req.admin?.username || 'Unknown'}`);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ============================================================
// EXPORT ROUTER
// ============================================================
module.exports = router;
