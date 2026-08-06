const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");
const fs = require("fs-extra");
const multer = require("multer");
const mysql = require("mysql2");

const app = express();
app.set("trust proxy", 1);

// ============================================================
// ENSURE UPLOAD DIRECTORIES EXIST
// ============================================================
const UPLOAD_DIR = path.join(__dirname, "uploads");
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, "thumbnails");

fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(THUMBNAIL_DIR);

// ============================================================
// CORS
// ============================================================
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// DATABASE CONNECTION
// ============================================================
const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "school_db",
  port: process.env.DB_PORT || 3306
});

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected successfully");
    createTables();
  }
});

// ============================================================
// CREATE TABLES IF NOT EXISTS
// ============================================================
function createTables() {
  const queries = [
    // Slider Images Table
    `CREATE TABLE IF NOT EXISTS slider_images (
      id INT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL UNIQUE,
      file_path VARCHAR(500) NOT NULL,
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

    // Recent Updates Table
    `CREATE TABLE IF NOT EXISTS recent_updates (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      file_url VARCHAR(500),
      file_public_id VARCHAR(255),
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

    // Analytics Table
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
}

// ============================================================
// MULTER CONFIGURATION FOR SLIDER IMAGES
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'slider-' + unique + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP and GIF images are allowed'), false);
  }
};

const uploadSlider = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: fileFilter
});

// ============================================================
// ROOT & TEST
// ============================================================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🏛️ School Management Backend",
    features: [
      "Recent Updates CRUD",
      "Slider Image Management",
      "Analytics Tracking"
    ],
    endpoints: {
      images: "/images",
      upload: "/upload",
      delete: "/delete",
      recent: "/recent/public",
      analytics: "/analytics/stats"
    }
  });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ Server Working!" });
});

// ============================================================
// SLIDER IMAGE ROUTES
// ============================================================

// GET - All Slider Images
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
      res.json(results);
    }
  );
});

// GET - Public Slider Images (for homepage)
app.get("/images/public", (req, res) => {
  db.query(
    `SELECT filename, file_path, title, alt_text, \`order\`
     FROM slider_images 
     WHERE is_active = 1 
     ORDER BY \`order\` ASC, created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json(results);
    }
  );
});

// GET - Slider Image Stats
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
      res.json({ success: true, data: results[0] });
    }
  );
});

// POST - Upload Slider Images
app.post("/upload", uploadSlider.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No images uploaded"
      });
    }

    const uploaded = [];
    const errors = [];

    // Get current max order
    const orderResult = await new Promise((resolve, reject) => {
      db.query("SELECT MAX(`order`) as maxOrder FROM slider_images", (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    let nextOrder = (orderResult[0]?.maxOrder || 0) + 1;

    for (const file of req.files) {
      try {
        const { title, alt_text } = req.body;

        await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO slider_images 
            (filename, file_path, file_size, mime_type, title, alt_text, \`order\`, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              file.filename,
              file.path,
              file.size,
              file.mimetype,
              title || file.originalname,
              alt_text || '',
              nextOrder++
            ],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });

        uploaded.push(file.filename);

      } catch (err) {
        errors.push({ file: file.filename, error: err.message });
        try {
          await fs.remove(file.path);
        } catch (e) {}
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
    res.status(500).json({
      success: false,
      message: error.message || "Upload failed"
    });
  }
});

// DELETE - Delete Slider Image
app.delete("/delete", (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res.status(400).json({
      success: false,
      message: "Filename is required"
    });
  }

  db.query(
    "SELECT * FROM slider_images WHERE filename = ?",
    [filename],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      if (results.length === 0) {
        return res.status(404).json({ success: false, message: "Image not found" });
      }

      const image = results[0];

      try {
        if (fs.existsSync(image.file_path)) {
          fs.removeSync(image.file_path);
        }
      } catch (e) {
        console.warn("⚠️ File deletion warning:", e.message);
      }

      db.query(
        "DELETE FROM slider_images WHERE filename = ?",
        [filename],
        (deleteErr) => {
          if (deleteErr) {
            console.error("❌ Delete DB Error:", deleteErr);
            return res.status(500).json({ success: false, error: deleteErr.message });
          }

          db.query(
            "SET @new_order = 0; UPDATE slider_images SET `order` = (@new_order := @new_order + 1) ORDER BY `order` ASC;",
            (reorderErr) => {
              if (reorderErr) {
                console.warn("⚠️ Reorder warning:", reorderErr.message);
              }
              res.json({ success: true, message: "Image deleted successfully" });
            }
          );
        }
      );
    }
  );
});

// PUT - Update Slider Image
app.put("/images/update/:id", (req, res) => {
  const { id } = req.params;
  const { title, alt_text, is_active } = req.body;

  db.query(
    `UPDATE slider_images 
     SET title = ?, alt_text = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [title || '', alt_text || '', is_active !== undefined ? is_active : 1, id],
    (err, result) => {
      if (err) {
        console.error("❌ Update Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Image not found" });
      }

      res.json({ success: true, message: "Image updated successfully" });
    }
  );
});

// PUT - Reorder Images
app.put("/images/reorder", (req, res) => {
  const { orders } = req.body;

  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({ success: false, message: "Orders array is required" });
  }

  const queries = orders.map(({ id, order }) => {
    return new Promise((resolve, reject) => {
      db.query(
        "UPDATE slider_images SET `order` = ? WHERE id = ?",
        [order, id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  });

  Promise.all(queries)
    .then(() => {
      res.json({ success: true, message: "Order updated successfully" });
    })
    .catch(error => {
      console.error("❌ Reorder Error:", error);
      res.status(500).json({ success: false, error: error.message });
    });
});

// ============================================================
// RECENT UPDATES ROUTES
// ============================================================

// GET - All Updates (Admin)
app.get("/recent/admin/all", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
     FROM recent_updates ORDER BY created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results });
    }
  );
});

// GET - Public Updates
app.get("/recent/public", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM recent_updates ORDER BY created_at DESC LIMIT 20`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results });
    }
  );
});

// GET - Single Update
app.get("/recent/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
     FROM recent_updates WHERE id = ?`,
    [id],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      if (!results.length) {
        return res.status(404).json({ success: false, message: "Update not found" });
      }
      res.json({ success: true, data: results[0] });
    }
  );
});

// POST - Add Update
app.post("/recent/admin/add", uploadSlider.single("file"), (req, res) => {
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  const file_url = req.file ? req.file.path : null;
  const file_public_id = req.file ? req.file.filename : null;
  const file_type = req.file ? req.file.mimetype : null;
  const file_size = req.file ? req.file.size : null;

  db.query(
    `INSERT INTO recent_updates 
    (title, description, file_url, file_public_id, file_type, file_size, category, link, is_new, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      title,
      description || "",
      file_url,
      file_public_id,
      file_type,
      file_size,
      category || "general",
      link || null,
      isNew !== undefined ? parseInt(isNew) : 1
    ],
    (err, result) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      db.query(
        `SELECT *, 
         DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
         FROM recent_updates WHERE id = ?`,
        [result.insertId],
        (fetchErr, fetchResult) => {
          res.status(201).json({
            success: true,
            message: "✅ Update added successfully!",
            data: fetchResult ? fetchResult[0] : { id: result.insertId }
          });
        }
      );
    }
  );
});

// PUT - Update Update
app.put("/recent/admin/update/:id", upload
