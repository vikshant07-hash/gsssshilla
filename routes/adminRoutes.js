const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// ============================================================
// HARDCODED ADMIN CREDENTIALS (Yahan change karein)
// ============================================================
const ADMIN = {
  id: 1,
  username: 'admin',
  password: '1234567',
  email: 'admin@school.com',
  name: 'Admin User',
  role: 'Super Admin'
};

// Hashed password for '1234567'
const HASHED_PASSWORD = '$2a$10$QjxQjxQjxQjxQjxQjxQjxOjxQjxQjxQjxQjxQjxQjxQjxQjxQjxQjxQjx';

// ============================================================
// JWT SECRET
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_key_12345';

// ============================================================
// VERIFY TOKEN MIDDLEWARE
// ============================================================
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];
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
// 1. LOGIN ROUTE
// ============================================================
router.post('/login', async (req, res) => {
  console.log('📥 Login request received:', req.body);
  
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required'
    });
  }

  try {
    // Check username
    if (username !== ADMIN.username) {
      console.log('❌ Invalid username:', username);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Check password using bcrypt
    const isMatch = await bcrypt.compare(password, HASHED_PASSWORD);
    console.log('🔐 Password match:', isMatch);
    
    if (!isMatch) {
      console.log('❌ Invalid password for user:', username);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Generate JWT Token
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
    console.error('❌ Login Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// ============================================================
// 2. VERIFY TOKEN ROUTE
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
    message: 'Token is valid'
  });
});

// ============================================================
// 3. GET PROFILE ROUTE
// ============================================================
router.get('/profile', verifyToken, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.admin.id || 1,
      username: req.admin.username || ADMIN.username,
      email: req.admin.email || ADMIN.email,
      name: req.admin.name || ADMIN.name,
      role: req.admin.role || ADMIN.role,
      last_login: new Date().toISOString(),
      created_at: '2024-01-01T00:00:00.000Z'
    }
  });
});

// ============================================================
// 4. LOGOUT ROUTE
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  console.log(`🔓 Admin logged out: ${req.admin?.username || 'Unknown'}`);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ============================================================
// 5. CHANGE PASSWORD ROUTE (Optional)
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
    const isMatch = await bcrypt.compare(oldPassword, HASHED_PASSWORD);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    res.json({
      success: true,
      message: 'Password changed successfully!'
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
// EXPORT
// ============================================================
module.exports = router;
