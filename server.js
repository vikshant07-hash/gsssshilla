const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");
const fs = require("fs-extra");
const session = require('express-session');
const { cloudinary, uploadSlider, uploadRecent, uploadGallery, uploadFaculty, uploadDownload } = require("./config/cloudinary");
const { db } = require("./config/db");

const app = express();
app.set("trust proxy", 1);

console.log("=".repeat(60));
console.log("🏛️ GSSS SHILLA - SCHOOL MANAGEMENT BACKEND");
console.log("=".repeat(60));

// ============================================================
// SECURITY HEADERS
// ============================================================
app.use((req, res, next) => {
    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // HSTS - Only in production
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    // Content Security Policy
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https://*.cloudinary.com https://*.pages.dev; " +
        "connect-src 'self' https://*.onrender.com; " +
        "media-src 'self' https://*.cloudinary.com;"
    );
    
    next();
});

// ============================================================
// SESSION MIDDLEWARE
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 30 * 60 * 1000, // 30 minutes
        sameSite: 'strict'
    },
    name: 'gsss_session' // Custom session cookie name
}));

// ============================================================
// CORS - SECURE CONFIGURATION
// ============================================================
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5500,https://gsssshilla07.pages.dev').split(',');

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token']
}));

// ============================================================
// RATE LIMITING - Global
// ============================================================
const rateLimitStore = new Map();

const globalRateLimiter = (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const max = 100; // 100 requests per window
    
    const record = rateLimitStore.get(key) || { count: 0, resetTime: now + windowMs };
    
    if (now > record.resetTime) {
        record.count = 0;
        record.resetTime = now + windowMs;
    }
    
    record.count++;
    rateLimitStore.set(key, record);
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());
    
    if (record.count > max) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil((record.resetTime - now) / 1000)
        });
    }
    
    next();
};

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Apply global rate limiter to all API routes
app.use('/api/', globalRateLimiter);

// ============================================================
// DATABASE MIGRATION - AUTO ADD COLUMNS
// ============================================================
function runMigration() {
  console.log("🔄 Checking database schema...");
  
  // Check for slider_images
  db.query("SHOW COLUMNS FROM slider_images LIKE 'public_id'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    if (!results || results.length === 0) {
      console.log("📌 Adding public_id column to slider_images...");
      db.query("ALTER TABLE slider_images ADD COLUMN public_id VARCHAR(255) AFTER file_path", (err) => {
        if (err) console.error("❌ Error adding public_id to slider_images:", err.message);
        else console.log("✅ public_id column added to slider_images");
      });
    } else {
      console.log("✅ public_id column already exists in slider_images");
    }
  });

  // Check for recent_updates
  db.query("SHOW COLUMNS FROM recent_updates LIKE 'public_id'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    if (!results || results.length === 0) {
      console.log("📌 Adding public_id column to recent_updates...");
      db.query("ALTER TABLE recent_updates ADD COLUMN public_id VARCHAR(255) AFTER file_url", (err) => {
        if (err) console.error("❌ Error adding public_id to recent_updates:", err.message);
        else console.log("✅ public_id column added to recent_updates");
      });
    } else {
      console.log("✅ public_id column already exists in recent_updates");
    }
  });

  // Check for gallery_images - image_date column
  db.query("SHOW COLUMNS FROM gallery_images LIKE 'image_date'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    if (!results || results.length === 0) {
      console.log("📌 Adding image_date column to gallery_images...");
      db.query("ALTER TABLE gallery_images ADD COLUMN image_date DATE AFTER description", (err) => {
        if (err) console.error("❌ Error adding image_date to gallery_images:", err.message);
        else {
          console.log("✅ image_date column added to gallery_images");
          db.query("UPDATE gallery_images SET image_date = DATE(created_at) WHERE image_date IS NULL", (err2) => {
            if (err2) console.error("❌ Error updating image_date:", err2.message);
            else console.log("✅ Existing rows updated with created_at date");
          });
        }
      });
    } else {
      console.log("✅ image_date column already exists in gallery_images");
    }
  });

  // Check for downloads - public_id column
  db.query("SHOW COLUMNS FROM downloads LIKE 'public_id'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    if (!results || results.length === 0) {
      console.log("📌 Adding public_id column to downloads...");
      db.query("ALTER TABLE downloads ADD COLUMN public_id VARCHAR(255) AFTER file_path", (err) => {
        if (err) console.error("❌ Error adding public_id to downloads:", err.message);
        else console.log("✅ public_id column added to downloads");
      });
    } else {
      console.log("✅ public_id column already exists in downloads");
    }
  });

  // Check for faculty - photo_public_id column
  db.query("SHOW COLUMNS FROM faculty LIKE 'photo_public_id'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    if (!results || results.length === 0) {
      console.log("📌 Adding photo_public_id column to faculty...");
      db.query("ALTER TABLE faculty ADD COLUMN photo_public_id VARCHAR(255) AFTER photo_url", (err) => {
        if (err) console.error("❌ Error adding photo_public_id to faculty:", err.message);
        else console.log("✅ photo_public_id column added to faculty");
      });
    } else {
      console.log("✅ photo_public_id column already exists in faculty");
    }
  });
}

// ============================================================
// CREATE TABLES (if not exist)
// ============================================================
function createTables() {
  const queries = [
    // Slider Images (Homepage)
    `CREATE TABLE IF NOT EXISTS slider_images (
      id INT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL UNIQUE,
      file_path VARCHAR(500) NOT NULL,
      public_id VARCHAR(255),
      file_size INT,
      mime_type VARCHAR(100),
      title VARCHAR(255) DEFAULT '',
      alt_text VARCHAR(255) DEFAULT '',
      \`order\` INT DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      views INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_order (\`order\`),
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Recent Updates
    `CREATE TABLE IF NOT EXISTS recent_updates (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      file_url VARCHAR(500),
      public_id VARCHAR(255),
      file_type VARCHAR(100),
      file_size INT,
      category VARCHAR(50) DEFAULT 'general',
      link VARCHAR(500),
      is_new BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_created (created_at DESC),
      INDEX idx_category (category),
      INDEX idx_is_new (is_new)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Notifications
    `CREATE TABLE IF NOT EXISTS notifications (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      file_url VARCHAR(500),
      public_id VARCHAR(255),
      file_name VARCHAR(255),
      file_size VARCHAR(50),
      file_type VARCHAR(100),
      attendance VARCHAR(50) DEFAULT 'all',
      is_active BOOLEAN DEFAULT 1,
      views INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_created (created_at DESC),
      INDEX idx_attendance (attendance),
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Contact Info
    `CREATE TABLE IF NOT EXISTS contact_info (
      id INT PRIMARY KEY DEFAULT 1,
      school_name VARCHAR(255) NOT NULL,
      address TEXT NOT NULL,
      phone VARCHAR(50) NOT NULL,
      email VARCHAR(100) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Contact Messages
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_created (created_at DESC),
      INDEX idx_read (is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Gallery Slider
    `CREATE TABLE IF NOT EXISTS gallery_slider (
      id INT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      public_id VARCHAR(255),
      title VARCHAR(255),
      description TEXT,
      link VARCHAR(500),
      \`order\` INT DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_order (\`order\`),
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Gallery Images (with video support)
    `CREATE TABLE IF NOT EXISTS gallery_images (
      id INT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      public_id VARCHAR(255),
      file_size INT DEFAULT 0,
      mime_type VARCHAR(100) DEFAULT 'image/jpeg',
      media_type ENUM('image', 'video') DEFAULT 'image',
      video_thumbnail VARCHAR(500),
      title VARCHAR(255) DEFAULT '',
      description TEXT,
      image_date DATE,
      category VARCHAR(100) DEFAULT 'general',
      \`order\` INT DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      view_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_image_date (image_date),
      INDEX idx_category (category),
      INDEX idx_order (\`order\`),
      INDEX idx_media_type (media_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Downloads
    `CREATE TABLE IF NOT EXISTS downloads (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      class VARCHAR(10) NOT NULL,
      session_year VARCHAR(20) NOT NULL,
      category VARCHAR(50) NOT NULL,
      series VARCHAR(10),
      subject VARCHAR(100),
      filename VARCHAR(255) NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      public_id VARCHAR(255),
      file_size INT,
      file_type VARCHAR(100),
      download_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_class (class),
      INDEX idx_session (session_year),
      INDEX idx_category (category),
      INDEX idx_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Faculty
    `CREATE TABLE IF NOT EXISTS faculty (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      designation VARCHAR(50) NOT NULL,
      department VARCHAR(50),
      subject VARCHAR(50),
      qualification VARCHAR(100),
      experience VARCHAR(50),
      email VARCHAR(100),
      phone VARCHAR(20),
      message TEXT,
      photo_url VARCHAR(500),
      photo_public_id VARCHAR(255),
      is_principal BOOLEAN DEFAULT 0,
      staff_type ENUM('teaching', 'non-teaching', 'administrative') DEFAULT 'teaching',
      is_active BOOLEAN DEFAULT 1,
      joining_date DATE,
      \`order\` INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_staff_type (staff_type),
      INDEX idx_principal (is_principal),
      INDEX idx_active (is_active),
      INDEX idx_order (\`order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Analytics
    `CREATE TABLE IF NOT EXISTS analytics (
      id INT PRIMARY KEY AUTO_INCREMENT,
      type VARCHAR(50) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      referrer VARCHAR(500),
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_type (type),
      INDEX idx_timestamp (timestamp DESC),
      INDEX idx_ip (ip_address)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  queries.forEach((query) => {
    db.query(query, (err) => {
      if (err) console.error("❌ Table creation error:", err.message);
    });
  });
  
  // Insert default contact info
  setTimeout(() => {
    db.query(
      `INSERT INTO contact_info (id, school_name, address, phone, email) 
       VALUES (1, 'GSSS SHILLA', 'Shilla, Himachal Pradesh', '+91 98765 43210', 'info@gssshilla.edu.in')
       ON DUPLICATE KEY UPDATE id = id`,
      (err) => {
        if (err) console.error("❌ Error inserting default contact info:", err.message);
        else console.log("✅ Default contact info inserted");
      }
    );
  }, 3000);
  
  setTimeout(runMigration, 2000);
}

// ============================================================
// CHECK DATABASE CONNECTION AND CREATE TABLES
// ============================================================
setTimeout(() => {
  console.log("🔄 Creating tables if not exist...");
  createTables();
}, 1000);

// ============================================================
// ============================================================
// LOAD ROUTES
// ============================================================
// ============================================================

console.log("📂 Loading routes...");

// Auth Routes (Login, OTP, Verify, etc.)
const authRoutes = require('./routes/authRoutes');
app.use('/api/admin', authRoutes);
console.log("✅ Auth routes loaded at /api/admin");

// Admin Routes (Protected Routes)
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);
console.log("✅ Admin routes loaded at /api/admin");

// ============================================================
// ============================================================
// PUBLIC ROUTES (No Auth Required)
// ============================================================
// ============================================================

console.log("📂 Loading public routes...");

// ============================================================
// ROOT & TEST
// ============================================================
app.get("/", (req, res) => {
  res.json({ 
    success: true, 
    message: "🏛️ GSSS SHILLA - School Management Backend",
    version: "2.0",
    security: {
      authentication: "JWT + Session",
      csrf: "Protected",
      rateLimiting: "Active",
      headers: "Secure",
      otp2FA: "Enabled"
    },
    routes: {
      admin: "/api/admin",
      public: "/api/public"
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ Server Working!", timestamp: new Date().toISOString() });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// SLIDER - PUBLIC
// ============================================================
app.get("/images/public", (req, res) => {
  db.query(
    `SELECT filename, file_path, public_id, title, alt_text, \`order\`
     FROM slider_images 
     WHERE is_active = 1 
     ORDER BY \`order\` ASC, created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json(results || []);
    }
  );
});

// ============================================================
// RECENT UPDATES - PUBLIC
// ============================================================
app.get("/recent/public", (req, res) => {
  db.query(
    `SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist 
     FROM recent_updates ORDER BY created_at DESC LIMIT 20`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

// ============================================================
// GALLERY - PUBLIC
// ============================================================
app.get("/api/gallery/slider", (req, res) => {
  db.query(
    `SELECT * FROM gallery_slider WHERE is_active = 1 ORDER BY \`order\` ASC, created_at DESC LIMIT 10`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json(results || []);
    }
  );
});

app.get("/api/gallery/images/public", (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     CASE 
       WHEN media_type = 'video' THEN CONCAT(SUBSTRING_INDEX(file_path, '.', 1), '.jpg')
       ELSE file_path 
     END as thumbnail_url
     FROM gallery_images 
     WHERE is_active = 1 AND YEAR(image_date) = ? 
     ORDER BY image_date DESC, created_at DESC`,
    [year],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results || [] });
    }
  );
});

app.get("/api/gallery/years", (req, res) => {
  db.query(
    `SELECT DISTINCT YEAR(image_date) as year FROM gallery_images WHERE is_active = 1 ORDER BY year DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      const years = results.map(r => r.year);
      res.json({ success: true, years: years.length ? years : [new Date().getFullYear()] });
    }
  );
});

// ============================================================
// FACULTY - PUBLIC
// ============================================================
app.get("/api/faculty", (req, res) => {
  db.query(
    `SELECT * FROM faculty WHERE is_active = 1 ORDER BY is_principal DESC, \`order\` ASC, name ASC`,
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      
      const principal = results.find(f => f.is_principal == 1);
      const teachingStaff = {};
      results.forEach(f => {
        if (!f.is_principal && f.staff_type === 'teaching') {
          const dept = f.department || 'Other';
          if (!teachingStaff[dept]) teachingStaff[dept] = [];
          teachingStaff[dept].push(f);
        }
      });
      const nonTeaching = results.filter(f => !f.is_principal && f.staff_type !== 'teaching');
      
      res.json({
        success: true,
        data: {
          principal: principal || null,
          teachingStaff: teachingStaff,
          nonTeaching: nonTeaching
        }
      });
    }
  );
});

app.get("/api/faculty/departments", (req, res) => {
  db.query(
    "SELECT DISTINCT department FROM faculty WHERE is_active = 1 AND department IS NOT NULL ORDER BY department",
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results.map(r => r.department) });
    }
  );
});

// ============================================================
// DOWNLOADS - PUBLIC
// ============================================================
app.get("/api/downloads", (req, res) => {
  const { class: classFilter, session, category, search, page = 1, limit = 20 } = req.query;
  
  let query = `SELECT id, title, description, class, session_year, category, series, subject, 
               file_type, file_size, download_count, 
               DATE_FORMAT(created_at, '%d/%m/%Y') as upload_date
               FROM downloads WHERE is_active = 1`;
  let countQuery = `SELECT COUNT(*) as total FROM downloads WHERE is_active = 1`;
  let params = [];

  if (classFilter && classFilter !== 'all') {
    query += ` AND class = ?`;
    countQuery += ` AND class = ?`;
    params.push(classFilter);
  }
  if (session && session !== 'all') {
    query += ` AND session_year = ?`;
    countQuery += ` AND session_year = ?`;
    params.push(session);
  }
  if (category && category !== 'all') {
    query += ` AND category = ?`;
    countQuery += ` AND category = ?`;
    params.push(category);
  }
  if (search) {
    query += ` AND (title LIKE ? OR description LIKE ? OR subject LIKE ?)`;
    countQuery += ` AND (title LIKE ? OR description LIKE ? OR subject LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  db.query(countQuery, params, (countErr, countResult) => {
    if (countErr) return res.status(500).json({ success: false, error: countErr.message });
    const total = countResult[0]?.total || 0;
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);
    db.query(query, params, (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({
        success: true,
        data: results || [],
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    });
  });
});

app.get("/api/downloads/:id/download", (req, res) => {
  const { id } = req.params;
  db.query("SELECT * FROM downloads WHERE id = ? AND is_active = 1", [id], (err, results) => {
    if (err || !results || results.length === 0) {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    db.query("UPDATE downloads SET download_count = download_count + 1 WHERE id = ?", [id]);
    res.redirect(results[0].file_path);
  });
});

app.get("/api/downloads/sessions", (req, res) => {
  db.query(
    "SELECT DISTINCT session_year FROM downloads WHERE is_active = 1 ORDER BY session_year DESC",
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results.map(r => r.session_year) });
    }
  );
});

app.get("/api/downloads/classes", (req, res) => {
  db.query(
    "SELECT DISTINCT class FROM downloads WHERE is_active = 1 ORDER BY CAST(class AS UNSIGNED) ASC",
    (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results.map(r => r.class) });
    }
  );
});

// ============================================================
// CONTACT - PUBLIC
// ============================================================
app.get("/api/contact/info", (req, res) => {
  db.query("SELECT * FROM contact_info WHERE id = 1", (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results || results.length === 0) {
      return res.json({
        success: true,
        data: {
          school_name: "GSSS SHILLA",
          address: "Shilla, Himachal Pradesh",
          phone: "+91 98765 43210",
          email: "info@gssshilla.edu.in"
        }
      });
    }
    res.json({ success: true, data: results[0] });
  });
});

app.post("/contact", (req, res) => {
  const { name, email, message } = req.body;
  
  if (!name || !email || !message) {
    return res.status(400).json({ 
      success: false, 
      message: "All fields are required (name, email, message)" 
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid email address"
    });
  }

  db.query(
    "INSERT INTO contact_messages (name, email, message, created_at) VALUES (?, ?, ?, NOW())",
    [name, email, message],
    (err, result) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to send message. Please try again later." 
        });
      }
      console.log(`✅ Contact message from ${name} (${email}) saved`);
      res.status(201).json({ 
        success: true, 
        message: "✅ Message sent successfully! We'll get back to you soon." 
      });
    }
  );
});

// ============================================================
// ANALYTICS - PUBLIC
// ============================================================
app.get("/analytics/track", (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  const referrer = req.headers['referer'] || '';
  
  db.query(
    `INSERT INTO analytics (type, ip_address, user_agent, referrer, timestamp) 
     VALUES ('visitor', ?, ?, ?, NOW())`,
    [ip, userAgent, referrer],
    (err) => { 
      if (err) console.error("Analytics Error:", err); 
    }
  );
  res.json({ success: true });
});

// ============================================================
// ============================================================
// 404 & ERROR HANDLER
// ============================================================
// ============================================================

// 404 Handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.url} - Not found`);
  res.status(404).json({ 
    success: false, 
    message: "❌ Route not found",
    path: req.url
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  console.error("Stack:", err.stack);
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(err.status || 500).json({ 
    success: false, 
    message: isProduction ? 'Internal Server Error' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

// ============================================================
// ============================================================
// SERVER START
// ============================================================
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("🏛️ GSSS SHILLA - SECURE BACKEND v2.0");
  console.log("=".repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log("=".repeat(60));
  console.log("🔒 SECURITY FEATURES:");
  console.log("  ✅ JWT Authentication");
  console.log("  ✅ Session Management (30 min)");
  console.log("  ✅ CSRF Protection");
  console.log("  ✅ Rate Limiting (100 req/15min)");
  console.log("  ✅ Security Headers (HSTS, CSP, etc.)");
  console.log("  ✅ OTP 2FA via Email");
  console.log("  ✅ Refresh Tokens");
  console.log("=".repeat(60));
  console.log("📂 ROUTES:");
  console.log("  🔐 Admin Routes: /api/admin");
  console.log("  🌐 Public Routes: /api/*, /images/*, /recent/*");
  console.log("=".repeat(60));
  console.log("✅ Server is ready!");
  console.log("=".repeat(60));
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Closing server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Closing server...');
  process.exit(0);
});
