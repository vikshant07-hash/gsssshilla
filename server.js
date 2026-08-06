const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

// ==================== IMPORT CONFIGS ====================
const { cloudinary } = require("./config/cloudinary");
const { uploadRecent } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== CORS ====================
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== STATIC FILES ====================
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ============================================================
// ==================== ROOT & TEST ROUTES ====================
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🏫 School Management Backend 🚀",
    timestamp: new Date().toISOString()
  });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ TEST WORKING!" });
});

// ============================================================
// ==================== DATABASE TEST ====================
// ============================================================

app.get("/db-test", (req, res) => {
  db.query("SELECT 1 as test, NOW() as time", (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "❌ Database connection failed",
        error: err.message
      });
    }
    res.json({
      success: true,
      message: "✅ Database connected successfully",
      data: results[0]
    });
  });
});

// ============================================================
// ==================== RECENT ROUTES ====================
// ============================================================

// ✅ GET - All Updates (Public)
app.get("/recent-public", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ 
        success: false, 
        error: err.message
      });
    }
    res.json({ success: true, data: results });
  });
});

// ✅ GET - All Updates (Admin)
app.get("/recent-admin-all", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC", (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, data: results });
  });
});

// ✅ POST - Add Update
app.post("/recent-admin-add", uploadRecent.single("file"), (req, res) => {
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
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
        return res.status(500).json({
          success: false,
          message: "Failed to add update",
          error: err.message
        });
      }

      db.query(
        "SELECT * FROM recent_updates WHERE id = ?",
        [result.insertId],
        (fetchErr, fetchResult) => {
          res.status(201).json({
            success: true,
            message: "Update added successfully ✅",
            data: fetchResult ? fetchResult[0] : { id: result.insertId }
          });
        }
      );
    }
  );
});

// ✅ PUT - Update Update
app.put("/recent-admin-update/:id", uploadRecent.single("file"), (req, res) => {
  const { id } = req.params;
  const { title, description, category, link, isNew } = req.body;

  if (!title) {
    return res.status(400).json({
      success: false,
      message: "Title is required"
    });
  }

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr || !fetchResult.length) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
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
            return res.status(500).json({
              success: false,
              message: "Failed to update",
              error: updateErr.message
            });
          }

          db.query(
            "SELECT * FROM recent_updates WHERE id = ?",
            [id],
            (fetchUpdatedErr, fetchUpdatedResult) => {
              res.json({
                success: true,
                message: "Update updated successfully ✅",
                data: fetchUpdatedResult ? fetchUpdatedResult[0] : null
              });
            }
          );
        }
      );
    }
  );
});

// ============================================================
// ✅ DELETE - Delete Update (FIXED - VERIFIED)
// ============================================================

app.delete("/recent-admin-delete/:id", (req, res) => {
  const { id } = req.params;
  console.log("🗑️ DELETE request received for ID:", id);

  // Validate ID
  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID provided"
    });
  }

  // Check if update exists
  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: fetchErr.message
        });
      }

      if (!fetchResult || fetchResult.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Update not found"
        });
      }

      const update = fetchResult[0];
      console.log("📦 Found update:", update.title);

      // Delete file from Cloudinary if exists
      if (update.file_public_id) {
        console.log("☁️ Deleting from Cloudinary:", update.file_public_id);
        cloudinary.uploader.destroy(update.file_public_id)
          .then(result => {
            console.log("✅ Cloudinary delete result:", result);
          })
          .catch(err => {
            console.error("❌ Cloudinary delete error:", err);
          });
      }

      // Delete from database
      db.query(
        "DELETE FROM recent_updates WHERE id = ?",
        [id],
        (deleteErr) => {
          if (deleteErr) {
            console.error("❌ Delete Error:", deleteErr);
            return res.status(500).json({
              success: false,
              message: "Failed to delete",
              error: deleteErr.message
            });
          }

          console.log("✅ Update deleted successfully");
          res.json({
            success: true,
            message: "Update deleted successfully ✅"
          });
        }
      );
    }
  );
});

// ✅ DELETE - Bulk Delete
app.delete("/recent-admin-bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No IDs provided"
    });
  }

  console.log("🗑️ Bulk delete request for IDs:", ids);

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(
    `SELECT * FROM recent_updates WHERE id IN (${placeholders})`,
    ids,
    (fetchErr, fetchResults) => {
      if (fetchErr) {
        console.error("❌ Fetch Error:", fetchErr);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch updates",
          error: fetchErr.message
        });
      }

      fetchResults.forEach(update => {
        if (update.file_public_id) {
          cloudinary.uploader.destroy(update.file_public_id)
            .catch(err => console.error("Cloudinary delete error:", err));
        }
      });

      db.query(
        `DELETE FROM recent_updates WHERE id IN (${placeholders})`,
        ids,
        (deleteErr) => {
          if (deleteErr) {
            console.error("❌ Delete Error:", deleteErr);
            return res.status(500).json({
              success: false,
              message: "Failed to delete",
              error: deleteErr.message
            });
          }

          res.json({
            success: true,
            message: `${ids.length} updates deleted successfully ✅`
          });
        }
      );
    }
  );
});

// ✅ GET - Admin Stats
app.get("/recent-admin-stats", (req, res) => {
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
        res.json({
          success: true,
          data: results
        });
      }
    });
  });
});

// ============================================================
// ==================== 404 HANDLER ====================
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl,
    availableRoutes: [
      "/",
      "/test",
      "/db-test",
      "/recent-public",
      "/recent-admin-all",
      "/recent-admin-add",
      "/recent-admin-update/:id",
      "/recent-admin-delete/:id (DELETE)",
      "/recent-admin-bulk-delete (DELETE)",
      "/recent-admin-stats"
    ]
  });
});

// ============================================================
// ==================== ERROR HANDLER ====================
// ============================================================

app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

// ============================================================
// ==================== PORT ====================
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🚀 SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log("=".repeat(50));
  console.log("✅ Available Routes:");
  console.log("  GET  /");
  console.log("  GET  /test");
  console.log("  GET  /recent-public");
  console.log("  GET  /recent-admin-all");
  console.log("  POST /recent-admin-add");
  console.log("  PUT  /recent-admin-update/:id");
  console.log("  DELETE /recent-admin-delete/:id");
  console.log("  DELETE /recent-admin-bulk-delete");
  console.log("  GET  /recent-admin-stats");
  console.log("=".repeat(50));
});
