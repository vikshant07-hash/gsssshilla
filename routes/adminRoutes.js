const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

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
// TEST ROUTE (WORKING)
// ============================================================
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Admin routes working!' });
});

// ============================================================
// 1. LOGIN ROUTE (FIX)
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

    // Check password
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
// 2. VERIFY ROUTE
// ============================================================
router.get('/verify', verifyToken, (req, res) => {
  res.json({ success: true, admin: req.admin, message: 'Token is valid' });
});

// ============================================================
// 3. PROFILE ROUTE
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
// 4. LOGOUT ROUTE
// ============================================================
router.post('/logout', verifyToken, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================================
// EXPORT
// ============================================================
console.log('✅ Admin routes exported!');
module.exports = router;
