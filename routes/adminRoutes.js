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
  username: 'admin',
  password: '1234567',
  email: 'vikshant07@gmail.com',
  name: 'Admin User',
  role: 'Super Admin'
};

const HASHED_PASSWORD = '$2a$10$QjxQjxQjxQjxQjxQjxQjxOjxQjxQjxQjxQjxQjxQjxQjxQjxQjxQjxQjx';
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

console.log('✅ Admin credentials loaded');

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
// 1. TEST ROUTE - VERIFY ROUTER IS WORKING
// ============================================================
router.get('/test', (req, res) => {
  console.log('📥 Test route hit!');
  res.json({ success: true, message: 'Admin routes working!' });
});

// ============================================================
// 2. LOGIN ROUTE - SEND OTP
// ============================================================
router.post('/login', async (req, res) => {
  console.log('🔥🔥🔥 LOGIN ROUTE HIT! 🔥🔥🔥');
  console.log('📥 Request body:', req.body);
  
  const { username, password } = req.body;

  if (!username || !password) {
    console.log('❌ Missing fields');
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  try {
    if (username !== ADMIN.username) {
      console.log('❌ Invalid username:', username);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const isMatch = await bcrypt.compare(password, HASHED_PASSWORD);
    console.log('🔐 Password match:', isMatch);
    
    if (!isMatch) {
      console.log('❌ Invalid password');
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;
    
    otpStore[username] = { otp, expiry };
    console.log(`📧 OTP for ${username}: ${otp}`);

    res.json({
      success: true,
      message: 'OTP sent successfully!',
      test_otp: otp
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
  console.log('🔥🔥🔥 VERIFY OTP ROUTE HIT! 🔥🔥🔥');
  console.log('📥 Request body:', req.body);
  
  const { username, password, otp } = req.body;

  if (!username || !password || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Username, password and OTP are required'
    });
  }

  try {
    if (username !== ADMIN.username) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const isMatch = await bcrypt.compare(password, HASHED_PASSWORD);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const stored = otpStore[username];
    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    if (stored.otp !== otp.toUpperCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (Date.now() > stored.expiry) {
      delete otpStore[username];
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
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
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// ============================================================
// 4. VERIFY ROUTE
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  console.log('📥 Verify route hit!');
  res.json({ success: true, admin: req.admin, message: 'Token is valid' });
});

// ============================================================
// 5. PROFILE ROUTE
// ============================================================
router.get('/profile', verifyToken, (req, res) => {
  console.log('📥 Profile route hit!');
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
  console.log('📥 Logout route hit!');
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================================
// 7. SEND RESET OTP
// ============================================================
router.post('/send-reset-otp', async (req, res) => {
  console.log('🔥🔥🔥 SEND RESET OTP ROUTE HIT! 🔥🔥🔥');
  
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }

  try {
    if (email !== ADMIN.email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found in our system'
      });
    }

    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000;
    
    otpStore[`reset_${email}`] = { otp, expiry };
    console.log(`📧 Reset OTP for ${email}: ${otp}`);

    res.json({
      success: true,
      message: 'Reset OTP sent successfully!',
      test_otp: otp
    });

  } catch (error) {
    console.error('❌ Send Reset OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// ============================================================
// 8. RESET PASSWORD
// ============================================================
router.post('/reset-password', async (req, res) => {
  console.log('🔥🔥🔥 RESET PASSWORD ROUTE HIT! 🔥🔥🔥');
  
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
      message: 'Password must be at least 6 characters'
    });
  }

  try {
    if (email !== ADMIN.email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found'
      });
    }

    const stored = otpStore[`reset_${email}`];
    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    if (stored.otp !== otp.toUpperCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (Date.now() > stored.expiry) {
      delete otpStore[`reset_${email}`];
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
    }

    delete otpStore[`reset_${email}`];

    console.log(`✅ Password reset for: ${email}`);

    res.json({
      success: true,
      message: 'Password reset successfully!'
    });

  } catch (error) {
    console.error('❌ Reset Password Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
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
// EXPORT - IMPORTANT!
// ============================================================
console.log('🔧 Exporting router...');
module.exports = router;
console.log('✅ Router exported successfully!');
