const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");
const fs = require("fs-extra");
const multer = require("multer");
const { cloudinary } = require("./config/cloudinary");
const { uploadRecent } = require("./config/cloudinary");
const { db } = require("./config/db");

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
    ]
  });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ Server Working!" });
});

// ============================================================
// ============================================================
// SLIDER IMAGE ROUTES
// ============================================================
// ============================================================

// ============================================================
// GET - All Slider Images
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
      res.json(results);
    }
  );
});

// ============================================================
// GET - Public Slider Images (for homepage)
// ============================================================
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

// ============================================================
// POST - Upload Slider Images
// ============================================================
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
        // Delete uploaded file if DB insert fails
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

// ============================================================
// DELETE - Delete Slider Image
// ============================================================
app.delete("/delete", (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res.status(400).json({ 
      success: false, 
      message: "Filename is required" 
    });
  }

  // Get image info from DB
  db.query(
    "SELECT * FROM slider_images WHERE filename = ?",
    [filename],
    (err, results) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ 
          success: false, 
          error: err.message 
        });
      }

      if (results.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Image not found" 
        });
      }

      const image = results[0];

      // Delete from filesystem
      try {
        if (fs.existsSync(image.file_path)) {
          fs.removeSync(image.file_path);
        }
      } catch (e) {
        console.warn("⚠️ File deletion warning:", e.message);
      }

      // Delete from DB
      db.query(
        "DELETE FROM slider_images WHERE filename = ?",
        [filename],
        (deleteErr) => {
          if (deleteErr) {
            console.error("❌ Delete DB Error:", deleteErr);
            return res.status(500).json({ 
              success: false, 
              error: deleteErr.message 
            });
          }

          // Reorder remaining images
          db.query(
            "SET @new_order = 0; UPDATE slider_images SET `order` = (@new_order := @new_order + 1) ORDER BY `order` ASC;",
            (reorderErr) => {
              if (reorderErr) {
                console.warn("⚠️ Reorder warning:", reorderErr.message);
              }
              res.json({ 
                success: true, 
                message: "Image deleted successfully" 
              });
            }
          );
        }
      );
    }
  );
});

// ============================================================
// PUT - Update Slider Image Order
// ============================================================
app.put("/images/reorder", (req, res) => {
  const { orders } = req.body;

  if (!orders || !Array.isArray(orders)) {
    return res.status(400).json({ 
      success: false, 
      message: "Orders array is required" 
    });
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
      res.json({ 
        success: true, 
        message: "Order updated successfully" 
      });
    })
    .catch(error => {
      console.error("❌ Reorder Error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    });
});

// ============================================================
// PUT - Update Slider Image (title, alt, active)
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
        return res.status(500).json({ 
          success: false, 
          error: err.message 
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Image not found" 
        });
      }

      res.json({ 
        success: true, 
        message: "Image updated successfully" 
      });
    }
  );
});

// ============================================================
// GET - Slider Image Stats
// ============================================================
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
        return res.status(500).json({ 
          success: false, 
          error: err.message 
        });
      }
      res.json({ 
        success: true, 
        data: results[0] 
      });
    }
  );
});

// ============================================================
// ============================================================
// RECENT UPDATES ROUTES (EXISTING)
// ============================================================
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
app.post("/recent/admin/add", uploadRecent.single("file"), (req, res) => {
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
app.put("/recent/admin/update/:id", uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: "Title is required" });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
    if (fetchErr || !fetchResult.length) {
      return res.status(404).json({ success: false, message: "Update not found" });
    }

    const existing = fetchResult[0];
    let file_url = existing.file_url;
    let file_public_id = existing.file_public_id;
    let file_type = existing.file_type;
    let file_size = existing.file_size;

    if (req.file) {
      if (existing.file_public_id) {
        cloudinary.uploader.destroy(existing.file_public_id)
          .catch(err => console.error("Cloudinary delete error:", err));
      }
      file_url = req.file.path;
      file_public_id = req.file.filename;
      file_type = req.file.mimetype;
      file_size = req.file.size;
    }

    db.query(
      `UPDATE recent_updates 
      SET title = ?, description = ?, file_url = ?, file_public_id = ?, 
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

// DELETE - Delete Update
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

    if (update.file_public_id) {
      cloudinary.uploader.destroy(update.file_public_id)
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
      if (update.file_public_id) {
        cloudinary.uploader.destroy(update.file_public_id)
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
// ANALYTICS ROUTES
// ============================================================
// ============================================================

// Track visitor
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

// Get analytics stats
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
// ============================================================
// 404 & ERROR HANDLER
// ============================================================
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
// ============================================================
// PORT
// ============================================================
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("🏛️ SCHOOL MANAGEMENT BACKEND (IST Timezone)");
  console.log("=".repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Timezone: IST (+05:30)`);
  console.log("=".repeat(60));
  console.log("✅ AVAILABLE ROUTES:");
  console.log("");
  console.log("📸 SLIDER IMAGES:");
  console.log("  GET    /images");
  console.log("  GET    /images/public");
  console.log("  GET    /images/stats");
  console.log("  PUT    /images/update/:id");
  console.log("  PUT    /images/reorder");
  console.log("  POST   /upload");
  console.log("  DELETE /delete");
  console.log("");
  console.log("📋 RECENT UPDATES:");
  console.log("  GET    /recent/public");
  console.log("  GET    /recent/admin/all");
  console.log("  POST   /recent/admin/add");
  console.log("  PUT    /recent/admin/update/:id");
  console.log("  DELETE /recent/admin/delete/:id");
  console.log("  DELETE /recent/admin/bulk-delete");
  console.log("  GET    /recent/admin/stats");
  console.log("");
  console.log("📊 ANALYTICS:");
  console.log("  GET    /analytics/track");
  console.log("  GET    /analytics/stats");
  console.log("=".repeat(60));
}); 
