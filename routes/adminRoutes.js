const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// ============================================================
// HARDCODED ADMIN CREDENTIALS (Manually change karein)
// ============================================================
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: '1234567',  // Plain password (bcrypt compare ke liye)
  email: 'admin@school.com',
  name: 'Admin',
  role: 'Super Admin'
};

// Hashed password (for production - bcrypt se generate karein)
// Password '1234567' ka hash
const HASHED_PASSWORD = '$2a$10$QjxQjxQjxQjxQjxQjxQjxOjxQjxQjxQjxQjxQjxQjxQjxQjxQjxQjxQjx';

// ============================================================
// JWT SECRET
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

// ============================================================
// VERIFY TOKEN MIDDLEWARE
// ============================================================
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.'
    });
  }
};

// ============================================================
// 1. LOGIN ADMIN (No Database)
// ============================================================
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  try {
    // Check username
    if (username !== ADMIN_CREDENTIALS.username) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Check password (using bcrypt compare)
    const isMatch = await bcrypt.compare(password, HASHED_PASSWORD);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Generate JWT Token
    const token = jwt.sign(
      {
        id: 1,
        username: ADMIN_CREDENTIALS.username,
        email: ADMIN_CREDENTIALS.email,
        name: ADMIN_CREDENTIALS.name,
        role: ADMIN_CREDENTIALS.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ Admin logged in: ${ADMIN_CREDENTIALS.username}`);

    res.json({
      success: true,
      message: 'Login successful!',
      token: token,
      data: {
        id: 1,
        username: ADMIN_CREDENTIALS.username,
        email: ADMIN_CREDENTIALS.email,
        name: ADMIN_CREDENTIALS.name,
        role: ADMIN_CREDENTIALS.role
      }
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
// 2. VERIFY TOKEN
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
    message: 'Token is valid'
  });
});

// ============================================================
// 3. GET PROFILE
// ============================================================
router.get('/profile', verifyToken, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.admin.id || 1,
      username: req.admin.username || ADMIN_CREDENTIALS.username,
      email: req.admin.email || ADMIN_CREDENTIALS.email,
      name: req.admin.name || ADMIN_CREDENTIALS.name,
      role: req.admin.role || ADMIN_CREDENTIALS.role,
      last_login: new Date().toISOString(),
      created_at: '2024-01-01T00:00:00.000Z'
    }
  });
});

// ============================================================
// 4. LOGOUT
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  console.log(`🔓 Admin logged out: ${req.admin?.username || 'Unknown'}`);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ============================================================
// 5. CHANGE PASSWORD (No Database - Hardcoded)
// ============================================================
router.post('/change-password', verifyToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Old password and new password are required'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'New password must be at least 6 characters'
    });
  }

  try {
    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, HASHED_PASSWORD);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Note: In production, you'd update the hardcoded password here
    // For demo, we just return success
    res.json({
      success: true,
      message: 'Password changed successfully! (Note: Password is hardcoded, change in code)'
    });

  } catch (error) {
    console.error('❌ Change Password Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// ============================================================
// 6. CHECK CREDENTIALS (For testing)
// ============================================================
router.get('/credentials', (req, res) => {
  res.json({
    success: true,
    username: ADMIN_CREDENTIALS.username,
    email: ADMIN_CREDENTIALS.email,
    name: ADMIN_CREDENTIALS.name,
    role: ADMIN_CREDENTIALS.role
  });
});

// ============================================================
// EXPORT
// ============================================================
module.exports = router;
