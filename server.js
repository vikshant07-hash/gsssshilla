const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");
const fs = require("fs-extra");
const { cloudinary, uploadSlider, uploadRecent } = require("./config/cloudinary");
const { db } = require("./config/db");

const app = express();
app.set("trust proxy", 1);

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
// DATABASE MIGRATION - AUTO ADD COLUMNS
// ============================================================
function runMigration() {
  console.log("🔄 Checking database schema...");
  
  // Check if public_id column exists in slider_images
  db.query("SHOW COLUMNS FROM slider_images LIKE 'public_id'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    
    if (!results || results.length === 0) {
      console.log("📌 Adding public_id column to slider_images...");
      db.query("ALTER TABLE slider_images ADD COLUMN public_id VARCHAR(255) AFTER file_path", (err) => {
        if (err) {
          console.error("❌ Error adding public_id to slider_images:", err.message);
        } else {
          console.log("✅ public_id column added to slider_images");
        }
      });
    } else {
      console.log("✅ public_id column already exists in slider_images");
    }
  });

  // Check if public_id column exists in recent_updates
  db.query("SHOW COLUMNS FROM recent_updates LIKE 'public_id'", (err, results) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return;
    }
    
    if (!results || results.length === 0) {
      console.log("📌 Adding public_id column to recent_updates...");
      db.query("ALTER TABLE recent_updates ADD COLUMN public_id VARCHAR(255) AFTER file_url", (err) => {
        if (err) {
          console.error("❌ Error adding public_id to recent_updates:", err.message);
        } else {
          console.log("✅ public_id column added to recent_updates");
        }
      });
    } else {
      console.log("✅ public_id column already exists in recent_updates");
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
  
  // Run migration after tables are created
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
// ROOT & TEST
// ============================================================
app.get("/", (req, res) => {
  res.json({ 
    success: true, 
    message: "🏛️ School Management Backend with Cloudinary",
    features: [
      "Recent Updates CRUD",
      "Slider Image Management",
      "Notification Module",
      "Analytics Tracking",
      "Cloudinary Storage"
    ]
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
      console.log("📸 Images fetched:", results ? results.length : 0);
      res.json(results || []);
    }
  );
});

// GET - Public Slider Images
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
      res.json({ 
        success: true, 
        data: results[0] || { total: 0, active: 0, inactive: 0 }
      });
    }
  );
});

// ============================================================
// POST - Upload Slider Images to Cloudinary
// ============================================================
app.post("/upload", uploadSlider.array('images', 20), async (req, res) => {
  console.log("📸 Upload request received");
  console.log("📸 Files:", req.files ? req.files.length : 0);
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "No images uploaded" 
      });
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

        console.log("📸 Cloudinary URL:", cloudinaryUrl);
        console.log("📸 Public ID:", publicId);

        await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO slider_images 
            (filename, file_path, public_id, file_size, mime_type, title, alt_text, \`order\`, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              publicId,
              cloudinaryUrl,
              publicId,
              file.size || 0,
              file.mimetype || 'image/jpeg',
              title || file.originalname,
              alt_text || '',
              nextOrder++
            ],
            (err, result) => {
              if (err) {
                console.error("❌ DB Insert Error:", err);
                reject(err);
              } else {
                console.log("✅ DB Insert Success:", publicId);
                resolve(result);
              }
            }
          );
        });

        uploaded.push({
          filename: publicId,
          url: cloudinaryUrl
        });

      } catch (err) {
        console.error("❌ Error saving image:", err);
        errors.push({ 
          file: file.originalname || file.filename, 
          error: err.message 
        });
        try {
          await cloudinary.uploader.destroy(file.filename);
        } catch (e) {}
      }
    }

    res.json({
      success: true,
      message: `${uploaded.length} images uploaded successfully to Cloudinary`,
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

// ============================================================
// DELETE - Slider Image
// ============================================================
app.delete("/delete", (req, res) => {
  const { filename } = req.body;

  console.log("🗑️ Delete request for:", filename);

  if (!filename) {
    return res.status(400).json({ 
      success: false, 
      message: "Filename/Public ID is required" 
    });
  }

  db.query(
    "SELECT * FROM slider_images WHERE filename = ? OR public_id = ?",
    [filename, filename],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      if (!results || results.length === 0) {
        return res.status(404).json({ success: false, message: "Image not found" });
      }

      const image = results[0];
      const publicId = image.public_id || image.filename;

      cloudinary.uploader.destroy(publicId)
        .then((result) => {
          console.log("✅ Cloudinary deleted:", result);
        })
        .catch((err) => {
          console.warn("⚠️ Cloudinary delete warning:", err.message);
        });

      db.query(
        "DELETE FROM slider_images WHERE id = ?",
        [image.id],
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
              res.json({ 
                success: true, 
                message: "Image deleted successfully from Cloudinary & Database" 
              });
            }
          );
        }
      );
    }
  );
});

// ============================================================
// PUT - Update Slider Image
// ============================================================
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

// ============================================================
// PUT - Reorder Slider Images
// ============================================================
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
      console.log("📋 Recent updates fetched:", results ? results.length : 0);
      res.json({ success: true, data: results || [] });
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
      res.json({ success: true, data: results || [] });
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
      if (!results || results.length === 0) {
        return res.status(404).json({ success: false, message: "Update not found" });
      }
      res.json({ success: true, data: results[0] });
    }
  );
});

// POST - Add Recent Update
app.post("/recent/admin/add", uploadRecent.single("file"), (req, res) => {
  console.log("📋 Add Update Request");
  console.log("📋 Body:", req.body);
  console.log("📋 File:", req.file ? req.file.filename : "No file");

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
    (title, description, file_url, public_id, file_type, file_size, category, link, is_new, created_at) 
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

      console.log("✅ Update added with ID:", result.insertId);

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

// PUT - Update Recent Update
app.put("/recent/admin/update/:id", uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, category, link, isNew } = req.body;

  console.log("📋 Update Request for ID:", id);

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Update not found" });
    }

    const existing = fetchResult[0];
    let file_url = existing.file_url;
    let file_public_id = existing.public_id;
    let file_type = existing.file_type;
    let file_size = existing.file_size;

    if (req.file) {
      if (existing.public_id) {
        cloudinary.uploader.destroy(existing.public_id)
          .then(result => console.log("✅ Old Cloudinary file deleted:", result))
          .catch(err => console.error("❌ Cloudinary delete error:", err));
      }
      file_url = req.file.path;
      file_public_id = req.file.filename;
      file_type = req.file.mimetype;
      file_size = req.file.size;
    }

    db.query(
      `UPDATE recent_updates 
      SET title = ?, description = ?, file_url = ?, public_id = ?, 
          file_type = ?, file_size = ?, category = ?, link = ?, is_new = ?, updated_at = NOW()
      WHERE id = ?`,
      [
        title,
        description || existing.description,
        file_url,
        file_public_id,
        file_type,
        file_size,
        category || existing.category,
        link || existing.link || null,
        isNew !== undefined ? parseInt(isNew) : existing.is_new,
        id
      ],
      (updateErr) => {
        if (updateErr) {
          console.error("❌ Update Error:", updateErr);
          return res.status(500).json({ success: false, error: updateErr.message });
        }

        db.query(
          `SELECT *, 
           DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
           DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
           FROM recent_updates WHERE id = ?`,
          [id],
          (fetchUpdatedErr, fetchUpdatedResult) => {
            res.json({
              success: true,
              message: "✅ Update updated successfully!",
              data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
            });
          }
        );
      }
    );
  });
});

// DELETE - Delete Recent Update
app.delete("/recent/admin/delete/:id", (req, res) => {
  const { id } = req.params;
  console.log("🗑️ DELETE ID:", id);

  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, message: "Database error", error: fetchErr.message });
    }

    if (!fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Update not found with ID: " + id });
    }

    const update = fetchResult[0];
    console.log("📦 Found:", update.title);

    if (update.public_id) {
      cloudinary.uploader.destroy(update.public_id)
        .then(result => console.log("✅ Cloudinary deleted:", result))
        .catch(err => console.error("❌ Cloudinary error:", err));
    }

    db.query("DELETE FROM recent_updates WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, message: "Failed to delete", error: deleteErr.message });
      }

      console.log("✅ Deleted ID:", id);
      res.json({ success: true, message: "✅ Update deleted successfully!" });
    });
  });
});

// DELETE - Bulk Delete
app.delete("/recent/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(`SELECT * FROM recent_updates WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    fetchResults.forEach(update => {
      if (update.public_id) {
        cloudinary.uploader.destroy(update.public_id)
          .catch(err => console.error("Cloudinary error:", err));
      }
    });

    db.query(`DELETE FROM recent_updates WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, error: deleteErr.message });
      }
      res.json({ success: true, message: `${ids.length} updates deleted successfully ✅` });
    });
  });
});

// GET - Admin Stats
app.get("/recent/admin/stats", (req, res) => {
  const queries = {
    total: "SELECT COUNT(*) as total FROM recent_updates",
    new: "SELECT COUNT(*) as new FROM recent_updates WHERE is_new = 1",
    old: "SELECT COUNT(*) as old FROM recent_updates WHERE is_new = 0",
    withFile: "SELECT COUNT(*) as withFile FROM recent_updates WHERE file_url IS NOT NULL"
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.query(query, (err, result) => {
      if (err) {
        console.error(`❌ Stats Error (${key}):`, err);
        results[key] = { error: err.message };
      } else {
        results[key] = result;
      }
      completed++;
      
      if (completed === totalQueries) {
        res.json({ success: true, data: results });
      }
    });
  });
});

// ============================================================
// ============================================================
// NOTIFICATION MODULE ROUTES
// ============================================================
// ============================================================

// ============================================================
// GET - All Notifications (Admin)
// ============================================================
app.get("/api/notifications/admin/all", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
     FROM notifications 
     ORDER BY created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      console.log("📋 Notifications fetched:", results ? results.length : 0);
      res.json({ success: true, data: results || [] });
    }
  );
});

// ============================================================
// GET - Public Notifications
// ============================================================
app.get("/api/notifications/public", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM notifications 
     WHERE is_active = 1 
     ORDER BY created_at DESC 
     LIMIT 20`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results || [] });
    }
  );
});

// ============================================================
// GET - Single Notification
// ============================================================
app.get("/api/notifications/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
     DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
     FROM notifications WHERE id = ?`,
    [id],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      if (!results || results.length === 0) {
        return res.status(404).json({ success: false, message: "Notification not found" });
      }
      res.json({ success: true, data: results[0] });
    }
  );
});

// ============================================================
// POST - Add Notification with File Upload
// ============================================================
app.post("/api/notifications/admin/add", uploadRecent.single("file"), (req, res) => {
  console.log("📋 Add Notification Request");
  console.log("📋 Body:", req.body);
  console.log("📋 File:", req.file ? req.file.filename : "No file");

  const { title, description, attendance } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  const file_url = req.file ? req.file.path : null;
  const public_id = req.file ? req.file.filename : null;
  const file_name = req.file ? req.file.originalname : null;
  const file_size = req.file ? req.file.size : null;
  const file_type = req.file ? req.file.mimetype : null;

  db.query(
    `INSERT INTO notifications 
    (title, description, file_url, public_id, file_name, file_size, file_type, attendance, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      title,
      description || "",
      file_url,
      public_id,
      file_name,
      file_size,
      file_type,
      attendance || "all"
    ],
    (err, result) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      console.log("✅ Notification added with ID:", result.insertId);

      db.query(
        `SELECT *, 
         DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
         FROM notifications WHERE id = ?`,
        [result.insertId],
        (fetchErr, fetchResult) => {
          res.status(201).json({
            success: true,
            message: "✅ Notification added successfully!",
            data: fetchResult ? fetchResult[0] : { id: result.insertId }
          });
        }
      );
    }
  );
});

// ============================================================
// PUT - Update Notification
// ============================================================
app.put("/api/notifications/admin/update/:id", uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, attendance, is_active } = req.body;

  console.log("📋 Update Notification Request for ID:", id);

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  db.query("SELECT * FROM notifications WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const existing = fetchResult[0];
    let file_url = existing.file_url;
    let public_id = existing.public_id;
    let file_name = existing.file_name;
    let file_size = existing.file_size;
    let file_type = existing.file_type;

    if (req.file) {
      // Delete old file from Cloudinary if exists
      if (existing.public_id) {
        cloudinary.uploader.destroy(existing.public_id)
          .then(result => console.log("✅ Old Cloudinary file deleted:", result))
          .catch(err => console.error("❌ Cloudinary delete error:", err));
      }
      file_url = req.file.path;
      public_id = req.file.filename;
      file_name = req.file.originalname;
      file_size = req.file.size;
      file_type = req.file.mimetype;
    }

    db.query(
      `UPDATE notifications 
      SET title = ?, description = ?, file_url = ?, public_id = ?, 
          file_name = ?, file_size = ?, file_type = ?, 
          attendance = ?, is_active = ?, updated_at = NOW()
      WHERE id = ?`,
      [
        title,
        description || existing.description,
        file_url,
        public_id,
        file_name,
        file_size,
        file_type,
        attendance || existing.attendance || "all",
        is_active !== undefined ? parseInt(is_active) : existing.is_active,
        id
      ],
      (updateErr) => {
        if (updateErr) {
          console.error("❌ Update Error:", updateErr);
          return res.status(500).json({ success: false, error: updateErr.message });
        }

        db.query(
          `SELECT *, 
           DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist,
           DATE_FORMAT(CONVERT_TZ(updated_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as updated_at_ist
           FROM notifications WHERE id = ?`,
          [id],
          (fetchUpdatedErr, fetchUpdatedResult) => {
            res.json({
              success: true,
              message: "✅ Notification updated successfully!",
              data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
            });
          }
        );
      }
    );
  });
});

// ============================================================
// DELETE - Delete Notification
// ============================================================
app.delete("/api/notifications/admin/delete/:id", (req, res) => {
  const { id } = req.params;
  console.log("🗑️ DELETE Notification ID:", id);

  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  db.query("SELECT * FROM notifications WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, message: "Database error", error: fetchErr.message });
    }

    if (!fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Notification not found with ID: " + id });
    }

    const notification = fetchResult[0];
    console.log("📦 Found:", notification.title);

    if (notification.public_id) {
      cloudinary.uploader.destroy(notification.public_id)
        .then(result => console.log("✅ Cloudinary deleted:", result))
        .catch(err => console.error("❌ Cloudinary error:", err));
    }

    db.query("DELETE FROM notifications WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, message: "Failed to delete", error: deleteErr.message });
      }

      console.log("✅ Deleted ID:", id);
      res.json({ success: true, message: "✅ Notification deleted successfully!" });
    });
  });
});

// ============================================================
// DELETE - Bulk Delete Notifications
// ============================================================
app.delete("/api/notifications/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(`SELECT * FROM notifications WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    fetchResults.forEach(notification => {
      if (notification.public_id) {
        cloudinary.uploader.destroy(notification.public_id)
          .catch(err => console.error("Cloudinary error:", err));
      }
    });

    db.query(`DELETE FROM notifications WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, error: deleteErr.message });
      }
      res.json({ success: true, message: `${ids.length} notifications deleted successfully ✅` });
    });
  });
});

// ============================================================
// GET - Notification Stats
// ============================================================
app.get("/api/notifications/admin/stats", (req, res) => {
  const queries = {
    total: "SELECT COUNT(*) as total FROM notifications",
    active: "SELECT COUNT(*) as active FROM notifications WHERE is_active = 1",
    inactive: "SELECT COUNT(*) as inactive FROM notifications WHERE is_active = 0",
    withFile: "SELECT COUNT(*) as withFile FROM notifications WHERE file_url IS NOT NULL"
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.query(query, (err, result) => {
      if (err) {
        console.error(`❌ Stats Error (${key}):`, err);
        results[key] = { error: err.message };
      } else {
        results[key] = result;
      }
      completed++;
      
      if (completed === totalQueries) {
        res.json({ success: true, data: results });
      }
    });
  });
});

// ============================================================
// CONTACT MODULE ROUTES
// ============================================================

// ============================================================
// GET - Contact Info (Public)
// ============================================================
app.get("/admin/contact/info", (req, res) => {
  db.query(
    `SELECT * FROM contact_info WHERE id = 1`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      
      if (!results || results.length === 0) {
        // Default values if no data
        return res.json({
          school_name: "GSS School Shilla",
          address: "Shilla, Himachal Pradesh",
          phone: "+91 98765 43210",
          email: "info@gssshilla.edu.in"
        });
      }
      
      res.json(results[0]);
    }
  );
});

// ============================================================
// POST - Contact Form Submit
// ============================================================
app.post("/contact", (req, res) => {
  const { name, email, message } = req.body;

  console.log("📩 Contact Form Submission:");
  console.log("Name:", name);
  console.log("Email:", email);
  console.log("Message:", message);

  if (!name || !email || !message) {
    return res.status(400).json({ 
      success: false, 
      message: "All fields are required" 
    });
  }

  // Save to database
  db.query(
    `INSERT INTO contact_messages (name, email, message, created_at) 
     VALUES (?, ?, ?, NOW())`,
    [name, email, message],
    (err, result) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to send message. Please try again." 
        });
      }

      console.log("✅ Message saved with ID:", result.insertId);
      
      res.json({
        success: true,
        message: "✅ Message sent successfully! We'll get back to you soon."
      });
    }
  );
});

// ============================================================
// GET - All Contact Messages (Admin)
// ============================================================
app.get("/admin/contact/messages", (req, res) => {
  db.query(
    `SELECT *, 
     DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%d/%m/%y %H:%i') as created_at_ist
     FROM contact_messages 
     ORDER BY created_at DESC`,
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, data: results || [] });
    }
  );
});

// ============================================================
// GET - Single Contact Message
// ============================================================
app.get("/admin/contact/messages/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT * FROM contact_messages WHERE id = ?`,
    [id],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      if (!results || results.length === 0) {
        return res.status(404).json({ success: false, message: "Message not found" });
      }
      res.json({ success: true, data: results[0] });
    }
  );
});

// ============================================================
// DELETE - Delete Contact Message
// ============================================================
app.delete("/admin/contact/messages/delete/:id", (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }

  db.query(
    "DELETE FROM contact_messages WHERE id = ?",
    [id],
    (err, result) => {
      if (err) {
        console.error("❌ Delete Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Message not found" });
      }

      res.json({ success: true, message: "✅ Message deleted successfully!" });
    }
  );
});

// ============================================================
// PUT - Update Contact Info
// ============================================================
app.put("/admin/contact/info/update", (req, res) => {
  const { school_name, address, phone, email } = req.body;

  if (!school_name || !address || !phone || !email) {
    return res.status(400).json({ 
      success: false, 
      message: "All fields are required" 
    });
  }

  db.query(
    `UPDATE contact_info 
     SET school_name = ?, address = ?, phone = ?, email = ?, updated_at = NOW()
     WHERE id = 1`,
    [school_name, address, phone, email],
    (err, result) => {
      if (err) {
        console.error("❌ Update Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }

      // If no rows affected, insert new
      if (result.affectedRows === 0) {
        db.query(
          `INSERT INTO contact_info (id, school_name, address, phone, email, created_at) 
           VALUES (1, ?, ?, ?, ?, NOW())`,
          [school_name, address, phone, email],
          (insertErr) => {
            if (insertErr) {
              console.error("❌ Insert Error:", insertErr);
              return res.status(500).json({ success: false, error: insertErr.message });
            }
            res.json({ success: true, message: "✅ Contact info saved!" });
          }
        );
      } else {
        res.json({ success: true, message: "✅ Contact info updated!" });
      }
    }
  );
});

// ============================================================
// GET - Contact Stats
// ============================================================
app.get("/admin/contact/stats", (req, res) => {
  const queries = {
    total: "SELECT COUNT(*) as total FROM contact_messages",
    today: "SELECT COUNT(*) as today FROM contact_messages WHERE DATE(created_at) = CURDATE()",
    week: "SELECT COUNT(*) as week FROM contact_messages WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
  };

  const results = {};
  let completed = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    db.query(query, (err, result) => {
      if (err) {
        console.error(`❌ Stats Error (${key}):`, err);
        results[key] = { error: err.message };
      } else {
        results[key] = result;
      }
      completed++;
      
      if (completed === totalQueries) {
        res.json({ success: true, data: results });
      }
    });
  });
});

// ============================================================
// ANALYTICS ROUTES
// ============================================================

app.get("/analytics/track", (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  const referrer = req.headers['referer'] || '';

  db.query(
    `INSERT INTO analytics (type, ip_address, user_agent, referrer, timestamp) 
     VALUES (?, ?, ?, ?, NOW())`,
    ['visitor', ip, userAgent, referrer],
    (err) => {
      if (err) {
        console.error("❌ Analytics Track Error:", err);
      }
      res.json({ success: true });
    }
  );
});

app.get("/analytics/stats", (req, res) => {
  db.query(
    `SELECT 
      COUNT(*) as total_visitors,
      COUNT(DISTINCT ip_address) as unique_visitors,
      COUNT(CASE WHEN DATE(timestamp) = CURDATE() THEN 1 END) as today_visitors
     FROM analytics 
     WHERE type = 'visitor'`,
    (err, results) => {
      if (err) {
        console.error("❌ Analytics Stats Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ 
        success: true, 
        total: results[0]?.total_visitors || 0,
        unique: results[0]?.unique_visitors || 0,
        today: results[0]?.today_visitors || 0,
        views: results[0]?.total_visitors || 0
      });
    }
  );
});

// ============================================================
// 404 & ERROR HANDLER
// ============================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl,
    availableRoutes: [
      "/",
      "/test",
      "/images",
      "/images/public",
      "/images/stats",
      "/images/update/:id",
      "/images/reorder",
      "/upload",
      "/delete",
      "/recent/public",
      "/recent/admin/all",
      "/recent/admin/add",
      "/recent/admin/update/:id",
      "/recent/admin/delete/:id",
      "/recent/admin/bulk-delete",
      "/recent/admin/stats",
      "/api/notifications/public",
      "/api/notifications/admin/all",
      "/api/notifications/admin/add",
      "/api/notifications/admin/update/:id",
      "/api/notifications/admin/delete/:id",
      "/api/notifications/admin/bulk-delete",
      "/api/notifications/admin/stats",
      "/api/notifications/:id",
      "/analytics/track",
      "/analytics/stats"
    ]
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
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
  console.log("=".repeat(60));
  console.log("✅ AVAILABLE ROUTES:");
  console.log("");
  console.log("📸 SLIDER IMAGES (Cloudinary):");
  console.log("  GET    /images");
  console.log("  GET    /images/public");
  console.log("  GET    /images/stats");
  console.log("  PUT    /images/update/:id");
  console.log("  PUT    /images/reorder");
  console.log("  POST   /upload");
  console.log("  DELETE /delete");
  console.log("");
  console.log("📋 RECENT UPDATES (Cloudinary):");
  console.log("  GET    /recent/public");
  console.log("  GET    /recent/admin/all");
  console.log("  POST   /recent/admin/add");
  console.log("  PUT    /recent/admin/update/:id");
  console.log("  DELETE /recent/admin/delete/:id");
  console.log("  DELETE /recent/admin/bulk-delete");
  console.log("  GET    /recent/admin/stats");
  console.log("");
  console.log("🔔 NOTIFICATIONS (Cloudinary):");
  console.log("  GET    /api/notifications/public");
  console.log("  GET    /api/notifications/admin/all");
  console.log("  POST   /api/notifications/admin/add");
  console.log("  PUT    /api/notifications/admin/update/:id");
  console.log("  DELETE /api/notifications/admin/delete/:id");
  console.log("  DELETE /api/notifications/admin/bulk-delete");
  console.log("  GET    /api/notifications/admin/stats");
  console.log("  GET    /api/notifications/:id");
  console.log("");
  console.log("📊 ANALYTICS:");
  console.log("  GET    /analytics/track");
  console.log("  GET    /analytics/stats");
  console.log("=".repeat(60));
});
