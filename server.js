const express = require("express");
const cors = require("cors");
const rateLimit = require('express-rate-limit');
require("dotenv").config();
const path = require("path");
const session = require('express-session');
const fs = require("fs-extra");
const fileUpload = require("express-fileupload");

const { cloudinary, uploadSlider, uploadRecent, uploadGallery, uploadFaculty, uploadDownload } = require("./config/cloudinary");
const { db } = require("./config/db");

// After other imports
const fileUpload = require('express-fileupload');
const resultRoutes = require('./routes/resultRoutes');

// After app.use(express.urlencoded...)
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/',
    limits: { fileSize: 50 * 1024 * 1024 }
}));

// Add result routes (before auth middleware)
app.use('/api/result', resultRoutes);
// 🔐 Import Auth Middleware
const authMiddleware = require('./middleware/auth');

const app = express();
app.set("trust proxy", 1);

// ============================================================
// RATE LIMITING
// ============================================================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        message: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

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
        maxAge: 30 * 60 * 1000,
        sameSite: 'lax'
    },
    name: 'gsss_session'
}));

// ============================================================
// CORS - ONLY ALLOW SPECIFIC DOMAINS
// ============================================================
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5500,https://gsssshilla07.pages.dev').split(',');

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token']
}));

app.options(/.*/, cors());

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// 🔐 SESSION CHECK HELPER
// ============================================================
const checkSession = (req, res, next) => {
    if (!req.session || !req.session.admin_id) {
        return res.status(401).json({
            success: false,
            message: 'Session expired. Please login again.',
            code: 'SESSION_EXPIRED'
        });
    }
    next();
};

// ============================================================
// ============================================================
// 🟢 PART 1: ALL PUBLIC ROUTES (NO AUTH REQUIRED)
// ============================================================
// ============================================================

// 1. Home route
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "🏛️ School Management Backend with Cloudinary",
        features: [
            "Recent Updates CRUD",
            "Slider Image Management",
            "Notification Module",
            "Contact Module",
            "Gallery Module (Month/Year Organized)",
            "Analytics Tracking",
            "Cloudinary Storage"
        ],
        auth: {
            status: "🔒 Protected",
            login: "/login",
            register: "/register"
        }
    });
});

// 2. Test route
app.get("/test", (req, res) => {
    res.json({ success: true, message: "✅ Server Working!" });
});

// 3. Public contact endpoint
app.post("/contact", (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: "Please enter a valid email address" });
    }

    db.query(`INSERT INTO contact_messages (name, email, message, created_at) VALUES (?, ?, ?, NOW())`,
        [name, email, message],
        (err, result) => {
            if (err) {
                console.error("❌ DB Error:", err);
                return res.status(500).json({ success: false, message: "Failed to send message" });
            }
            res.status(201).json({ success: true, message: "✅ Message sent successfully!" });
        }
    );
});


app.use('/api/result', resultRoutes);

// 4. Public analytics tracking
app.get("/analytics/track", (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || '';
    db.query(`INSERT INTO analytics (type, ip_address, user_agent, referrer, timestamp) VALUES ('visitor', ?, ?, ?, NOW())`,
        [ip, userAgent, referrer], (err) => { if (err) console.error("Analytics Error:", err); }
    );
    res.json({ success: true });
});

// 5. Public analytics stats
app.get("/analytics/stats", (req, res) => {
    db.query(`SELECT COUNT(*) as total, COUNT(DISTINCT ip_address) as unique_visitors, COUNT(CASE WHEN DATE(timestamp)=CURDATE() THEN 1 END) as today FROM analytics WHERE type='visitor'`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, total: results[0]?.total || 0, unique: results[0]?.unique_visitors || 0, today: results[0]?.today || 0 });
        }
    );
});

// ============================================================
// 🟢 PUBLIC SLIDER ROUTES
// ============================================================

// Public slider images (NO AUTH)
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
// 🟢 PUBLIC RECENT UPDATES ROUTES
// ============================================================

// Public recent updates (NO AUTH)
app.get("/recent/public", (req, res) => {
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM recent_updates ORDER BY created_at DESC LIMIT 20`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

// ============================================================
// 🟢 PUBLIC GALLERY ROUTES
// ============================================================

// Public gallery images (NO AUTH)
app.get("/api/gallery/images/public", (req, res) => {
    const year = req.query.year || new Date().getFullYear();
    db.query(
        `SELECT *, 
         DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
         CASE 
           WHEN media_type = 'video' THEN CONCAT(SUBSTRING_INDEX(file_path, '.', 1), '.jpg')
           ELSE file_path 
         END as thumbnail_url,
         CASE 
           WHEN media_type = 'video' THEN CONCAT(file_path, '.jpg')
           ELSE NULL 
         END as video_poster
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

// Public gallery years (NO AUTH)
app.get("/api/gallery/years", (req, res) => {
    db.query(`SELECT DISTINCT YEAR(image_date) as year FROM gallery_images WHERE is_active = 1 ORDER BY year DESC`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            const years = results.map(r => r.year);
            res.json({ success: true, years: years.length ? years : [new Date().getFullYear()] });
        }
    );
});

// Public gallery slider (NO AUTH)
app.get("/api/gallery/slider", (req, res) => {
    db.query(`SELECT * FROM gallery_slider WHERE is_active = 1 ORDER BY \`order\` ASC, created_at DESC LIMIT 10`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json(results || []);
        }
    );
});

// ============================================================
// 🟢 PUBLIC FACULTY ROUTES
// ============================================================

// Public faculty (NO AUTH)
app.get("/api/faculty", (req, res) => {
    const query = `SELECT * FROM faculty WHERE is_active = 1 ORDER BY is_principal DESC, \`order\` ASC, name ASC`;

    db.query(query, (err, results) => {
        if (err) {
            console.error("❌ Faculty Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }

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
    });
});

// Public faculty departments (NO AUTH)
app.get("/api/faculty/departments", (req, res) => {
    db.query("SELECT DISTINCT department FROM faculty WHERE is_active = 1 AND department IS NOT NULL ORDER BY department",
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results.map(r => r.department) });
        }
    );
});

// ============================================================
// 🟢 PUBLIC DOWNLOADS ROUTES
// ============================================================

// Public downloads (NO AUTH)
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
        if (countErr) {
            console.error("❌ Count Error:", countErr);
            return res.status(500).json({ success: false, error: countErr.message });
        }

        const total = countResult[0]?.total || 0;

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);

        db.query(query, params, (err, results) => {
            if (err) {
                console.error("❌ Downloads Error:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
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

// Public download by ID (NO AUTH)
app.get("/api/downloads/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM downloads WHERE id = ? AND is_active = 1", [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "File not found" });
        res.json({ success: true, data: results[0] });
    });
});

// Public download file (NO AUTH)
app.get("/api/downloads/:id/download", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM downloads WHERE id = ? AND is_active = 1", [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "File not found" });

        const file = results[0];
        db.query("UPDATE downloads SET download_count = download_count + 1 WHERE id = ?", [id]);
        res.redirect(file.file_path);
    });
});

// Public download sessions (NO AUTH)
app.get("/api/downloads/sessions", (req, res) => {
    db.query("SELECT DISTINCT session_year FROM downloads WHERE is_active = 1 ORDER BY session_year DESC",
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results.map(r => r.session_year) });
        }
    );
});

// Public download classes (NO AUTH)
app.get("/api/downloads/classes", (req, res) => {
    db.query("SELECT DISTINCT class FROM downloads WHERE is_active = 1 ORDER BY CAST(class AS UNSIGNED) ASC",
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results.map(r => r.class) });
        }
    );
});

// ============================================================
// 🟢 PUBLIC CONTACT ROUTES
// ============================================================

// Public contact info (NO AUTH)
app.get("/api/contact/info", (req, res) => {
    db.query(`SELECT * FROM contact_info WHERE id = 1`, (err, results) => {
        if (err) {
            console.error("❌ DB Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
        if (!results || results.length === 0) {
            return res.json({
                success: true,
                data: {
                    school_name: "GSS School Shilla",
                    address: "Shilla, Himachal Pradesh",
                    phone: "+91 98765 43210",
                    email: "info@gssshilla.edu.in"
                }
            });
        }
        res.json({ success: true, data: results[0] });
    });
});

// ============================================================
// 🟢 PUBLIC NOTIFICATIONS
// ============================================================

// Public notifications (NO AUTH)
app.get("/api/notifications/public", (req, res) => {
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM notifications WHERE is_active = 1 ORDER BY created_at DESC LIMIT 20`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

// ============================================================
// ============================================================
// 🟡 PART 2: ADMIN ROUTES (Registered BEFORE auth middleware)
// ============================================================
// ============================================================

console.log('🔧 Loading admin routes...');

try {
    const adminRoutes = require('./routes/adminRoutes');
    console.log('✅ Admin routes loaded successfully');
    app.use('/api/admin', adminRoutes);
    console.log('✅ Admin routes registered at /api/admin');

    app.get('/api/admin/direct-test', (req, res) => {
        res.json({ success: true, message: 'Direct test working!' });
    });

} catch (error) {
    console.error('❌ Error loading admin routes:', error.message);
}

// ============================================================
// ============================================================
// 🔴 PART 3: PROTECTED ROUTES (Auth middleware ke BAAD)
// ============================================================
// ============================================================

app.use(authMiddleware);

// ============================================================
// DATABASE MIGRATION - AUTO ADD COLUMNS
// ============================================================
function runMigration() {
    console.log("🔄 Checking database schema...");

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

    db.query("SHOW COLUMNS FROM gallery_images LIKE 'media_type'", (err, results) => {
        if (err) {
            console.error("❌ Error checking columns:", err.message);
            return;
        }
        if (!results || results.length === 0) {
            console.log("📌 Adding media_type column to gallery_images...");
            db.query("ALTER TABLE gallery_images ADD COLUMN media_type VARCHAR(20) DEFAULT 'image' AFTER mime_type", (err) => {
                if (err) console.error("❌ Error adding media_type to gallery_images:", err.message);
                else console.log("✅ media_type column added to gallery_images");
            });
        } else {
            console.log("✅ media_type column already exists in gallery_images");
        }
    });

    db.query("SHOW COLUMNS FROM gallery_images LIKE 'video_thumbnail'", (err, results) => {
        if (err) {
            console.error("❌ Error checking columns:", err.message);
            return;
        }
        if (!results || results.length === 0) {
            console.log("📌 Adding video_thumbnail column to gallery_images...");
            db.query("ALTER TABLE gallery_images ADD COLUMN video_thumbnail VARCHAR(500) AFTER media_type", (err) => {
                if (err) console.error("❌ Error adding video_thumbnail to gallery_images:", err.message);
                else console.log("✅ video_thumbnail column added to gallery_images");
            });
        } else {
            console.log("✅ video_thumbnail column already exists in gallery_images");
        }
    });

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

        `CREATE TABLE IF NOT EXISTS contact_info (
            id INT PRIMARY KEY DEFAULT 1,
            school_name VARCHAR(255) NOT NULL,
            address TEXT NOT NULL,
            phone VARCHAR(50) NOT NULL,
            email VARCHAR(100) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

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

        `CREATE TABLE IF NOT EXISTS gallery_images (
            id INT PRIMARY KEY AUTO_INCREMENT,
            filename VARCHAR(255) NOT NULL,
            file_path VARCHAR(500) NOT NULL,
            public_id VARCHAR(255),
            file_size INT DEFAULT 0,
            mime_type VARCHAR(100) DEFAULT 'image/jpeg',
            media_type VARCHAR(20) DEFAULT 'image',
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
            INDEX idx_order (\`order\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

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

    setTimeout(() => {
        db.query(
            `INSERT INTO contact_info (id, school_name, address, phone, email) 
             VALUES (1, 'GSS School Shilla', 'Shilla, Himachal Pradesh', '+91 98765 43210', 'info@gssshilla.edu.in')
             ON DUPLICATE KEY UPDATE id = id`,
            (err) => {
                if (err) console.error("❌ Error inserting default contact info:", err.message);
                else console.log("✅ Default contact info inserted");
            }
        );
    }, 3000);

    setTimeout(runMigration, 2000);
}

setTimeout(() => {
    console.log("🔄 Creating tables if not exist...");
    createTables();
}, 1000);

// ============================================================
// 🔴 PROTECTED SLIDER ROUTES (Admin only)
// ============================================================

app.get("/images", (req, res) => {
    db.query(
        `SELECT *, 
         DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
         FROM slider_images 
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

app.get("/images/stats", (req, res) => {
    db.query(
        `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive
         FROM slider_images`,
        (err, results) => {
            if (err) {
                console.error("❌ Stats Error:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({
                success: true,
                data: results[0] || { total: 0, active: 0, inactive: 0 }
            });
        }
    );
});

app.post("/upload", uploadSlider.array('images', 20), async (req, res) => {
    console.log("📸 Upload request received");
    console.log("📸 Files:", req.files ? req.files.length : 0);

    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "No images uploaded" });
        }

        const uploaded = [];
        const errors = [];

        const orderResult = await new Promise((resolve, reject) => {
            db.query("SELECT MAX(`order`) as maxOrder FROM slider_images", (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        let nextOrder = (orderResult[0]?.maxOrder || 0) + 1;

        for (const file of req.files) {
            try {
                const cloudinaryUrl = file.path;
                const publicId = file.filename;
                const { title, alt_text } = req.body;

                await new Promise((resolve, reject) => {
                    db.query(
                        `INSERT INTO slider_images 
                        (filename, file_path, public_id, file_size, mime_type, title, alt_text, \`order\`, created_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                        [publicId, cloudinaryUrl, publicId, file.size || 0, file.mimetype || 'image/jpeg', title || file.originalname, alt_text || '', nextOrder++],
                        (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        }
                    );
                });

                uploaded.push({ filename: publicId, url: cloudinaryUrl });
            } catch (err) {
                errors.push({ file: file.originalname || file.filename, error: err.message });
                try { await cloudinary.uploader.destroy(file.filename); } catch (e) { }
            }
        }

        res.json({
            success: true,
            message: `${uploaded.length} images uploaded successfully`,
            uploaded: uploaded,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error("❌ Upload Error:", error);
        res.status(500).json({ success: false, message: error.message || "Upload failed" });
    }
});

app.delete("/delete", (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ success: false, message: "Filename/Public ID is required" });

    db.query("SELECT * FROM slider_images WHERE filename = ? OR public_id = ?", [filename, filename], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "Image not found" });

        const image = results[0];
        const publicId = image.public_id || image.filename;
        cloudinary.uploader.destroy(publicId).catch(err => console.warn("Cloudinary warning:", err.message));

        db.query("DELETE FROM slider_images WHERE id = ?", [image.id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });

            db.query("SELECT id FROM slider_images ORDER BY `order` ASC", (fetchErr, rows) => {
                if (fetchErr || !rows || rows.length === 0) {
                    if (fetchErr) console.warn("Reorder warning:", fetchErr.message);
                    return res.json({ success: true, message: "Image deleted successfully" });
                }

                const updates = rows.map((row, index) =>
                    new Promise((resolve) => {
                        db.query("UPDATE slider_images SET `order` = ? WHERE id = ?", [index + 1, row.id], (updateErr) => {
                            if (updateErr) console.warn("Reorder warning:", updateErr.message);
                            resolve();
                        });
                    })
                );

                Promise.all(updates).then(() => {
                    res.json({ success: true, message: "Image deleted successfully" });
                });
            });
        });
    });
});

app.put("/images/update/:id", (req, res) => {
    const { id } = req.params;
    const { title, alt_text, is_active } = req.body;
    db.query(`UPDATE slider_images SET title = ?, alt_text = ?, is_active = ?, updated_at = NOW() WHERE id = ?`,
        [title || '', alt_text || '', is_active !== undefined ? is_active : 1, id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Image not found" });
            res.json({ success: true, message: "Image updated successfully" });
        }
    );
});

app.put("/images/reorder", (req, res) => {
    const { orders } = req.body;
    if (!orders || !Array.isArray(orders)) return res.status(400).json({ success: false, message: "Orders array is required" });

    const queries = orders.map(({ id, order }) => {
        return new Promise((resolve, reject) => {
            db.query("UPDATE slider_images SET `order` = ? WHERE id = ?", [order, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });

    Promise.all(queries)
        .then(() => res.json({ success: true, message: "Order updated successfully" }))
        .catch(error => res.status(500).json({ success: false, error: error.message }));
});

// ============================================================
// 🔴 PROTECTED RECENT UPDATES ROUTES (Admin only)
// ============================================================

app.get("/recent/admin/all", (req, res) => {
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM recent_updates ORDER BY created_at DESC`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

app.post("/recent/admin/add", uploadRecent.single("file"), (req, res) => {
    const { title, description, category, link, isNew } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    const file_url = req.file ? req.file.path : null;
    const file_public_id = req.file ? req.file.filename : null;
    const file_type = req.file ? req.file.mimetype : null;
    const file_size = req.file ? req.file.size : null;

    db.query(`INSERT INTO recent_updates (title, description, file_url, public_id, file_type, file_size, category, link, is_new, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [title, description || "", file_url, file_public_id, file_type, file_size, category || "general", link || null, isNew !== undefined ? parseInt(isNew) : 1],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.status(201).json({ success: true, message: "✅ Update added successfully!", data: { id: result.insertId } });
        }
    );
});

app.put("/recent/admin/update/:id", uploadRecent.single("file"), (req, res) => {
    const { id } = req.params;
    const { title, description, category, link, isNew } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
        if (fetchErr || !fetchResult || fetchResult.length === 0) return res.status(404).json({ success: false, message: "Update not found" });

        const existing = fetchResult[0];
        let file_url = existing.file_url, file_public_id = existing.public_id, file_type = existing.file_type, file_size = existing.file_size;

        if (req.file) {
            if (existing.public_id) cloudinary.uploader.destroy(existing.public_id).catch(err => console.error("Cloudinary error:", err));
            file_url = req.file.path;
            file_public_id = req.file.filename;
            file_type = req.file.mimetype;
            file_size = req.file.size;
        }

        db.query(`UPDATE recent_updates SET title=?, description=?, file_url=?, public_id=?, file_type=?, file_size=?, category=?, link=?, is_new=?, updated_at=NOW() WHERE id=?`,
            [title, description || existing.description, file_url, file_public_id, file_type, file_size, category || existing.category, link || existing.link || null, isNew !== undefined ? parseInt(isNew) : existing.is_new, id],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
                res.json({ success: true, message: "✅ Update updated successfully!" });
            }
        );
    });
});

app.delete("/recent/admin/delete/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
        if (fetchErr || !fetchResult || fetchResult.length === 0) return res.status(404).json({ success: false, message: "Update not found" });

        const update = fetchResult[0];
        if (update.public_id) cloudinary.uploader.destroy(update.public_id).catch(err => console.error("Cloudinary error:", err));

        db.query("DELETE FROM recent_updates WHERE id = ?", [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: "✅ Update deleted successfully!" });
        });
    });
});

app.delete("/recent/admin/bulk-delete", (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: "No IDs provided" });

    const placeholders = ids.map(() => '?').join(',');
    db.query(`SELECT * FROM recent_updates WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
        if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
        fetchResults.forEach(update => { if (update.public_id) cloudinary.uploader.destroy(update.public_id).catch(err => console.error("Cloudinary error:", err)); });
        db.query(`DELETE FROM recent_updates WHERE id IN (${placeholders})`, ids, (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: `${ids.length} updates deleted successfully ✅` });
        });
    });
});

// ============================================================
// 🔴 PROTECTED NOTIFICATION ROUTES (Admin only)
// ============================================================

app.get("/api/notifications/admin/all", (req, res) => {
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM notifications ORDER BY created_at DESC`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

app.post("/api/notifications/admin/add", uploadRecent.single("file"), (req, res) => {
    const { title, description, attendance } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    const file_url = req.file ? req.file.path : null;
    const public_id = req.file ? req.file.filename : null;
    const file_name = req.file ? req.file.originalname : null;
    const file_size = req.file ? req.file.size : null;
    const file_type = req.file ? req.file.mimetype : null;

    db.query(`INSERT INTO notifications (title, description, file_url, public_id, file_name, file_size, file_type, attendance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [title, description || "", file_url, public_id, file_name, file_size, file_type, attendance || "all"],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.status(201).json({ success: true, message: "✅ Notification added successfully!", data: { id: result.insertId } });
        }
    );
});

app.put("/api/notifications/admin/update/:id", uploadRecent.single("file"), (req, res) => {
    const { id } = req.params;
    const { title, description, attendance, is_active } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    db.query("SELECT * FROM notifications WHERE id = ?", [id], (fetchErr, fetchResult) => {
        if (fetchErr || !fetchResult || fetchResult.length === 0) return res.status(404).json({ success: false, message: "Notification not found" });

        const existing = fetchResult[0];
        let file_url = existing.file_url, public_id = existing.public_id, file_name = existing.file_name, file_size = existing.file_size, file_type = existing.file_type;

        if (req.file) {
            if (existing.public_id) cloudinary.uploader.destroy(existing.public_id).catch(err => console.error("Cloudinary error:", err));
            file_url = req.file.path;
            public_id = req.file.filename;
            file_name = req.file.originalname;
            file_size = req.file.size;
            file_type = req.file.mimetype;
        }

        db.query(`UPDATE notifications SET title=?, description=?, file_url=?, public_id=?, file_name=?, file_size=?, file_type=?, attendance=?, is_active=?, updated_at=NOW() WHERE id=?`,
            [title, description || existing.description, file_url, public_id, file_name, file_size, file_type, attendance || existing.attendance || "all", is_active !== undefined ? parseInt(is_active) : existing.is_active, id],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
                res.json({ success: true, message: "✅ Notification updated successfully!" });
            }
        );
    });
});

app.delete("/api/notifications/admin/delete/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM notifications WHERE id = ?", [id], (fetchErr, fetchResult) => {
        if (fetchErr || !fetchResult || fetchResult.length === 0) return res.status(404).json({ success: false, message: "Notification not found" });
        const notification = fetchResult[0];
        if (notification.public_id) cloudinary.uploader.destroy(notification.public_id).catch(err => console.error("Cloudinary error:", err));
        db.query("DELETE FROM notifications WHERE id = ?", [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: "✅ Notification deleted successfully!" });
        });
    });
});

app.delete("/api/notifications/admin/bulk-delete", (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: "No IDs provided" });
    const placeholders = ids.map(() => '?').join(',');
    db.query(`SELECT * FROM notifications WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
        if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
        fetchResults.forEach(n => { if (n.public_id) cloudinary.uploader.destroy(n.public_id).catch(err => console.error("Cloudinary error:", err)); });
        db.query(`DELETE FROM notifications WHERE id IN (${placeholders})`, ids, (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: `${ids.length} notifications deleted successfully ✅` });
        });
    });
});

// ============================================================
// 🔴 PROTECTED CONTACT ROUTES (Admin only)
// ============================================================

app.get("/admin/contact/info", (req, res) => {
    db.query(`SELECT * FROM contact_info WHERE id = 1`, (err, results) => {
        if (err) {
            console.error("❌ DB Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
        if (!results || results.length === 0) {
            return res.json({
                school_name: "GSS School Shilla",
                address: "Shilla, Himachal Pradesh",
                phone: "+91 98765 43210",
                email: "info@gssshilla.edu.in"
            });
        }
        res.json(results[0]);
    });
});

app.put("/admin/contact/info/update", (req, res) => {
    const { school_name, address, phone, email } = req.body;
    if (!school_name || !address || !phone || !email) {
        return res.status(400).json({ success: false, message: "All fields are required" });
    }

    db.query("SELECT id FROM contact_info WHERE id = 1", (err, results) => {
        if (err) {
            console.error("❌ DB Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (results && results.length > 0) {
            db.query(
                `UPDATE contact_info SET school_name = ?, address = ?, phone = ?, email = ?, updated_at = NOW() WHERE id = 1`,
                [school_name, address, phone, email],
                (updateErr) => {
                    if (updateErr) {
                        console.error("❌ Update Error:", updateErr);
                        return res.status(500).json({ success: false, error: updateErr.message });
                    }
                    res.json({ success: true, message: "✅ Contact information updated successfully!" });
                }
            );
        } else {
            db.query(
                `INSERT INTO contact_info (id, school_name, address, phone, email, created_at) VALUES (1, ?, ?, ?, ?, NOW())`,
                [school_name, address, phone, email],
                (insertErr) => {
                    if (insertErr) {
                        console.error("❌ Insert Error:", insertErr);
                        return res.status(500).json({ success: false, error: insertErr.message });
                    }
                    res.json({ success: true, message: "✅ Contact information saved successfully!" });
                }
            );
        }
    });
});

app.get("/admin/contact/messages", (req, res) => {
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM contact_messages ORDER BY created_at DESC`,
        (err, results) => {
            if (err) {
                console.error("❌ DB Error:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, data: results || [] });
        }
    );
});

app.get("/admin/contact/messages/:id", (req, res) => {
    const { id } = req.params;
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM contact_messages WHERE id = ?`,
        [id],
        (err, results) => {
            if (err) {
                console.error("❌ DB Error:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            if (!results || results.length === 0) {
                return res.status(404).json({ success: false, message: "Message not found" });
            }
            db.query("UPDATE contact_messages SET is_read = 1 WHERE id = ?", [id]);
            res.json({ success: true, data: results[0] });
        }
    );
});

app.put("/admin/contact/messages/read/:id", (req, res) => {
    const { id } = req.params;
    db.query("UPDATE contact_messages SET is_read = 1 WHERE id = ?", [id], (err, result) => {
        if (err) {
            console.error("❌ Update Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Message not found" });
        }
        res.json({ success: true, message: "✅ Marked as read" });
    });
});

app.delete("/admin/contact/messages/delete/:id", (req, res) => {
    const { id } = req.params;
    if (!id || isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid ID" });
    }
    db.query("DELETE FROM contact_messages WHERE id = ?", [id], (err, result) => {
        if (err) {
            console.error("❌ Delete Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Message not found" });
        }
        res.json({ success: true, message: "✅ Message deleted successfully!" });
    });
});

app.delete("/admin/contact/messages/bulk-delete", (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "No IDs provided" });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.query(`DELETE FROM contact_messages WHERE id IN (${placeholders})`, ids, (deleteErr, result) => {
        if (deleteErr) {
            console.error("❌ Delete Error:", deleteErr);
            return res.status(500).json({ success: false, error: deleteErr.message });
        }
        res.json({ success: true, message: `${result.affectedRows} messages deleted successfully ✅` });
    });
});

app.get("/admin/contact/stats", (req, res) => {
    const queries = {
        total: "SELECT COUNT(*) as count FROM contact_messages",
        unread: "SELECT COUNT(*) as count FROM contact_messages WHERE is_read = 0",
        today: "SELECT COUNT(*) as count FROM contact_messages WHERE DATE(created_at) = CURDATE()",
        week: "SELECT COUNT(*) as count FROM contact_messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
    };

    const results = {};
    let completed = 0;
    const totalQueries = Object.keys(queries).length;

    Object.entries(queries).forEach(([key, query]) => {
        db.query(query, (err, result) => {
            if (err) results[key] = { count: 0 };
            else results[key] = result[0] || { count: 0 };
            completed++;
            if (completed === totalQueries) {
                res.json({
                    success: true,
                    data: {
                        total: results.total?.count || 0,
                        unread: results.unread?.count || 0,
                        today: results.today?.count || 0,
                        week: results.week?.count || 0
                    }
                });
            }
        });
    });
});

// ============================================================
// 🔴 PROTECTED GALLERY ROUTES (Admin only)
// ============================================================

app.get("/api/gallery/slider/admin/all", (req, res) => {
    db.query(`SELECT * FROM gallery_slider ORDER BY \`order\` ASC, created_at DESC`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

app.post("/api/gallery/slider/add", uploadSlider.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "Image is required" });

    const { title, description, link } = req.body;
    const file_path = req.file.path;
    const public_id = req.file.filename;
    const filename = req.file.filename;

    db.query("SELECT MAX(`order`) as maxOrder FROM gallery_slider", (err, result) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const nextOrder = (result[0]?.maxOrder || 0) + 1;

        db.query(`INSERT INTO gallery_slider (filename, file_path, public_id, title, description, link, \`order\`, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
            [filename, file_path, public_id, title || '', description || '', link || '', nextOrder],
            (insertErr, insertResult) => {
                if (insertErr) return res.status(500).json({ success: false, error: insertErr.message });
                res.json({ success: true, message: "✅ Slider image added!", data: { id: insertResult.insertId } });
            }
        );
    });
});

app.put("/api/gallery/slider/update/:id", (req, res) => {
    const { id } = req.params;
    const { title, description, link, is_active } = req.body;
    db.query(`UPDATE gallery_slider SET title=?, description=?, link=?, is_active=?, updated_at=NOW() WHERE id=?`,
        [title || '', description || '', link || '', is_active !== undefined ? parseInt(is_active) : 1, id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Image not found" });
            res.json({ success: true, message: "✅ Slider updated!" });
        }
    );
});

app.delete("/api/gallery/slider/delete/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM gallery_slider WHERE id = ?", [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "Image not found" });

        const image = results[0];
        if (image.public_id) cloudinary.uploader.destroy(image.public_id).catch(err => console.error("Cloudinary error:", err));

        db.query("DELETE FROM gallery_slider WHERE id = ?", [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: "✅ Slider deleted!" });
        });
    });
});

app.put("/api/gallery/slider/reorder", (req, res) => {
    const { orders } = req.body;
    if (!orders || !Array.isArray(orders)) return res.status(400).json({ success: false, message: "Orders array is required" });

    const queries = orders.map(({ id, order }) => {
        return new Promise((resolve, reject) => {
            db.query("UPDATE gallery_slider SET `order` = ? WHERE id = ?", [order, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });

    Promise.all(queries).then(() => res.json({ success: true, message: "✅ Reordered!" }))
        .catch(error => res.status(500).json({ success: false, error: error.message }));
});

// ============================================================
// 🔴 PROTECTED GALLERY IMAGES ROUTES (Admin only)
// ============================================================

app.get("/api/gallery/images/admin/recent", (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM gallery_images ORDER BY created_at DESC LIMIT ?`,
        [limit],
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

app.get("/api/gallery/images", (req, res) => {
    db.query(`SELECT *, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist FROM gallery_images ORDER BY created_at DESC LIMIT 50`,
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

app.post("/api/gallery/images/add", uploadGallery.array('media', 30), async (req, res) => {
    const { title, description, image_date } = req.body;

    console.log("📸 Add Gallery Media Request");
    console.log("📸 Title:", title);
    console.log("📸 Date:", image_date);
    console.log("📸 Files:", req.files ? req.files.length : 0);

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: "No media uploaded" });
    }

    const uploaded = [];
    const errors = [];
    const uploadDate = image_date || new Date().toISOString().split('T')[0];

    for (const file of req.files) {
        try {
            const isVideo = file.mimetype?.startsWith('video/') || false;
            const filePath = file.path;
            const publicId = file.filename;

            let videoThumbnail = null;
            if (isVideo) {
                videoThumbnail = filePath.replace(/\.[^.]+$/, '.jpg');
            }

            await new Promise((resolve, reject) => {
                db.query(
                    `INSERT INTO gallery_images 
                     (filename, file_path, public_id, file_size, mime_type, media_type, 
                      video_thumbnail, title, description, image_date, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        publicId,
                        filePath,
                        publicId,
                        file.size || 0,
                        file.mimetype || (isVideo ? 'video/mp4' : 'image/jpeg'),
                        isVideo ? 'video' : 'image',
                        videoThumbnail,
                        title || '',
                        description || '',
                        uploadDate
                    ],
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                );
            });
            uploaded.push({ filename: publicId, type: isVideo ? 'video' : 'image' });
        } catch (err) {
            console.error("❌ Upload error:", err);
            errors.push({ file: file.originalname, error: err.message });
        }
    }

    res.json({
        success: true,
        message: `${uploaded.length} media items uploaded successfully!`,
        uploaded: uploaded,
        errors: errors.length > 0 ? errors : undefined
    });
});

app.put("/api/gallery/images/update/:id", (req, res) => {
    const { id } = req.params;
    const { title, description, image_date, is_active } = req.body;

    db.query(`UPDATE gallery_images SET title=?, description=?, image_date=?, is_active=?, updated_at=NOW() WHERE id=?`,
        [title || '', description || '', image_date || null, is_active !== undefined ? parseInt(is_active) : 1, id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Item not found" });
            res.json({ success: true, message: "✅ Gallery item updated!" });
        }
    );
});

app.delete("/api/gallery/images/delete/:id", (req, res) => {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "Invalid ID" });

    db.query("SELECT * FROM gallery_images WHERE id = ?", [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "Item not found" });

        const item = results[0];
        if (item.public_id) {
            cloudinary.uploader.destroy(item.public_id, {
                resource_type: item.media_type === 'video' ? 'video' : 'image'
            }).catch(err => console.error("Cloudinary error:", err));
        }

        db.query("DELETE FROM gallery_images WHERE id = ?", [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: "✅ Gallery item deleted!" });
        });
    });
});

app.delete("/api/gallery/images/bulk-delete", (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "No IDs provided" });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.query(`SELECT * FROM gallery_images WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
        if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });

        fetchResults.forEach(item => {
            if (item.public_id) {
                cloudinary.uploader.destroy(item.public_id, {
                    resource_type: item.media_type === 'video' ? 'video' : 'image'
                }).catch(err => console.error("Cloudinary error:", err));
            }
        });

        db.query(`DELETE FROM gallery_images WHERE id IN (${placeholders})`, ids, (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: `${ids.length} items deleted ✅` });
        });
    });
});

app.get("/api/gallery/stats", (req, res) => {
    const queries = {
        total_images: "SELECT COUNT(*) as count FROM gallery_images WHERE is_active = 1 AND media_type = 'image'",
        total_videos: "SELECT COUNT(*) as count FROM gallery_images WHERE is_active = 1 AND media_type = 'video'",
        total_slider: "SELECT COUNT(*) as count FROM gallery_slider WHERE is_active = 1",
        total_years: "SELECT COUNT(DISTINCT YEAR(image_date)) as count FROM gallery_images WHERE is_active = 1"
    };

    const results = {};
    let completed = 0;
    const totalQueries = Object.keys(queries).length;

    Object.entries(queries).forEach(([key, query]) => {
        db.query(query, (err, result) => {
            if (err) results[key] = { count: 0 };
            else results[key] = result[0] || { count: 0 };
            completed++;
            if (completed === totalQueries) {
                res.json({
                    success: true,
                    data: {
                        total_images: results.total_images?.count || 0,
                        total_videos: results.total_videos?.count || 0,
                        total_slider: results.total_slider?.count || 0,
                        total_years: results.total_years?.count || 0
                    }
                });
            }
        });
    });
});

// ============================================================
// 🔴 PROTECTED DOWNLOAD ROUTES (Admin only)
// ============================================================

app.get("/admin/downloads", (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    db.query("SELECT COUNT(*) as total FROM downloads", (countErr, countResult) => {
        if (countErr) return res.status(500).json({ success: false, error: countErr.message });
        const total = countResult[0]?.total || 0;
        db.query("SELECT * FROM downloads ORDER BY created_at DESC LIMIT ? OFFSET ?", [parseInt(limit), offset], (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({
                success: true,
                data: results || [],
                pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
            });
        });
    });
});

app.post("/admin/downloads/add", uploadDownload.single("file"), (req, res) => {
    const { title, description, class: classNum, session_year, category, series, subject } = req.body;

    console.log("📥 Add Download Request:", req.body);

    if (!title || !classNum || !session_year || !category) {
        return res.status(400).json({ success: false, message: "Title, Class, Session and Category are required" });
    }

    if (!req.file) {
        return res.status(400).json({ success: false, message: "File is required" });
    }

    db.query(
        `INSERT INTO downloads (title, description, class, session_year, category, series, subject, 
         filename, file_path, public_id, file_size, file_type, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            title,
            description || '',
            classNum,
            session_year,
            category,
            series || null,
            subject || null,
            req.file.filename,
            req.file.path,
            req.file.filename,
            req.file.size || 0,
            req.file.mimetype || 'application/pdf'
        ],
        (err, result) => {
            if (err) {
                console.error("❌ Insert Error:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.status(201).json({
                success: true,
                message: "✅ File uploaded successfully!",
                data: { id: result.insertId }
            });
        }
    );
});

app.put("/admin/downloads/update/:id", uploadDownload.single("file"), (req, res) => {
    const { id } = req.params;
    const { title, description, class: classNum, session_year, category, series, subject, is_active } = req.body;

    if (!title || !classNum || !session_year || !category) {
        return res.status(400).json({ success: false, message: "Title, Class, Session and Category are required" });
    }

    db.query("SELECT * FROM downloads WHERE id = ?", [id], (fetchErr, fetchResult) => {
        if (fetchErr || !fetchResult || fetchResult.length === 0) {
            return res.status(404).json({ success: false, message: "Download not found" });
        }

        const existing = fetchResult[0];
        let file_path = existing.file_path;
        let public_id = existing.public_id;
        let filename = existing.filename;
        let file_size = existing.file_size;
        let file_type = existing.file_type;

        if (req.file) {
            if (existing.public_id) {
                cloudinary.uploader.destroy(existing.public_id)
                    .catch(err => console.error("Cloudinary delete error:", err));
            }
            file_path = req.file.path;
            public_id = req.file.filename;
            filename = req.file.filename;
            file_size = req.file.size || 0;
            file_type = req.file.mimetype || 'application/pdf';
        }

        db.query(
            `UPDATE downloads SET title=?, description=?, class=?, session_year=?, category=?, 
             series=?, subject=?, filename=?, file_path=?, public_id=?, file_size=?, file_type=?, 
             is_active=?, updated_at=NOW() WHERE id=?`,
            [
                title, description || '', classNum, session_year, category,
                series || null, subject || null, filename, file_path, public_id,
                file_size, file_type, is_active !== undefined ? parseInt(is_active) : 1, id
            ],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
                res.json({ success: true, message: "✅ Download updated successfully!" });
            }
        );
    });
});

app.delete("/admin/downloads/delete/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM downloads WHERE id = ?", [id], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "Not found" });

        const item = results[0];
        if (item.public_id) {
            cloudinary.uploader.destroy(item.public_id)
                .catch(err => console.error("Cloudinary error:", err));
        }

        db.query("DELETE FROM downloads WHERE id = ?", [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: "✅ Deleted successfully!" });
        });
    });
});

app.delete("/admin/downloads/bulk-delete", (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: "No IDs provided" });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.query(`SELECT * FROM downloads WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
        if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
        fetchResults.forEach(item => {
            if (item.public_id) cloudinary.uploader.destroy(item.public_id).catch(err => console.error(err));
        });
        db.query(`DELETE FROM downloads WHERE id IN (${placeholders})`, ids, (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: `${ids.length} items deleted ✅` });
        });
    });
});

app.get("/admin/downloads/stats", (req, res) => {
    const queries = {
        total: "SELECT COUNT(*) as count FROM downloads",
        active: "SELECT COUNT(*) as count FROM downloads WHERE is_active = 1",
        total_downloads: "SELECT SUM(download_count) as count FROM downloads",
        categories: "SELECT category, COUNT(*) as count FROM downloads GROUP BY category"
    };

    const results = {};
    let completed = 0;
    const totalQueries = Object.keys(queries).length;

    Object.entries(queries).forEach(([key, query]) => {
        db.query(query, (err, result) => {
            if (err) results[key] = { count: 0 };
            else results[key] = key === 'categories' ? result : (result[0] || { count: 0 });
            completed++;
            if (completed === totalQueries) {
                res.json({ success: true, data: results });
            }
        });
    });
});

// ============================================================
// 🔴 PROTECTED FACULTY ROUTES (Admin only)
// ============================================================

app.get("/admin/faculty", (req, res) => {
    db.query("SELECT * FROM faculty ORDER BY is_principal DESC, staff_type ASC, `order` ASC, name ASC",
        (err, results) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: results || [] });
        }
    );
});

app.get("/admin/faculty/:id", (req, res) => {
    db.query("SELECT * FROM faculty WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!results || results.length === 0) return res.status(404).json({ success: false, message: "Not found" });
        res.json({ success: true, data: results[0] });
    });
});

app.post("/admin/faculty/add", uploadFaculty.single("photo"), (req, res) => {
    const { name, designation, department, subject, qualification, experience, email, phone, message, is_principal, staff_type, joining_date } = req.body;

    if (!name || !designation) {
        return res.status(400).json({ success: false, message: "Name and Designation are required" });
    }

    const photo_url = req.file ? req.file.path : null;
    const photo_public_id = req.file ? req.file.filename : null;

    db.query(
        `INSERT INTO faculty (name, designation, department, subject, qualification, experience, email, phone, message, photo_url, photo_public_id, is_principal, staff_type, joining_date, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [name, designation, department || null, subject || null, qualification || null, experience || null, email || null, phone || null, message || null, photo_url, photo_public_id, is_principal || 0, staff_type || 'teaching', joining_date || null],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.status(201).json({ success: true, message: "✅ Faculty added!", data: { id: result.insertId } });
        }
    );
});

app.put("/admin/faculty/update/:id", uploadFaculty.single("photo"), (req, res) => {
    const { id } = req.params;
    const { name, designation, department, subject, qualification, experience, email, phone, message, is_principal, staff_type, is_active, joining_date } = req.body;

    if (!name || !designation) {
        return res.status(400).json({ success: false, message: "Name and Designation are required" });
    }

    db.query("SELECT * FROM faculty WHERE id = ?", [id], (err, results) => {
        if (err || !results || results.length === 0) {
            return res.status(404).json({ success: false, message: "Not found" });
        }

        const existing = results[0];
        let photo_url = existing.photo_url;
        let photo_public_id = existing.photo_public_id;

        if (req.file) {
            if (existing.photo_public_id) {
                cloudinary.uploader.destroy(existing.photo_public_id).catch(e => console.error(e));
            }
            photo_url = req.file.path;
            photo_public_id = req.file.filename;
        }

        db.query(
            `UPDATE faculty SET name=?, designation=?, department=?, subject=?, qualification=?, experience=?, email=?, phone=?, message=?, photo_url=?, photo_public_id=?, is_principal=?, staff_type=?, is_active=?, joining_date=?, updated_at=NOW() WHERE id=?`,
            [name, designation, department || null, subject || null, qualification || null, experience || null, email || null, phone || null, message || null, photo_url, photo_public_id, is_principal || 0, staff_type || 'teaching', is_active !== undefined ? parseInt(is_active) : 1, joining_date || null, id],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });
                res.json({ success: true, message: "✅ Faculty updated!" });
            }
        );
    });
});

app.delete("/admin/faculty/delete/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM faculty WHERE id = ?", [id], (err, results) => {
        if (err || !results || results.length === 0) return res.status(404).json({ success: false, message: "Not found" });

        const item = results[0];
        if (item.photo_public_id) {
            cloudinary.uploader.destroy(item.photo_public_id).catch(e => console.error(e));
        }

        db.query("DELETE FROM faculty WHERE id = ?", [id], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
            res.json({ success: true, message: "✅ Faculty deleted!" });
        });
    });
});

// ============================================================
// 404 & ERROR HANDLER
// ============================================================
app.use((req, res) => {
    res.status(404).json({ success: false, message: "❌ Route not found" });
});

app.use((err, req, res, next) => {
    console.error("❌ Server Error:", err.message);
    res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
});

// ============================================================
// PORT
// ============================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("=".repeat(60));
    console.log("🏛️ SCHOOL MANAGEMENT BACKEND with Cloudinary");
    console.log("=".repeat(60));
    console.log(`📡 Port: ${PORT}`);
    console.log(`☁️ Cloudinary: Connected`);
    console.log(`🔐 Authentication: ENABLED (Session + JWT)`);
    console.log("=".repeat(60));
    console.log("✅ GALLERY MODULE: Month/Year Organized (No album_id)");
    console.log("=".repeat(60));
});
