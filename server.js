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
// ==================== ✅ RECENT ROUTES - FIXED ====================
// ============================================================

// ✅ Import recent routes
let recentRoutes = null;
try {
  recentRoutes = require("./routes/recentRoutes");
  console.log("✅ Recent routes file loaded successfully");
} catch (error) {
  console.error("❌ Failed to load recent routes:", error.message);
}

// ✅ Register recent routes
if (recentRoutes) {
  app.use("/recent", recentRoutes);
  console.log("✅ Recent routes registered at /recent");
} else {
  console.log("⚠️ Creating fallback routes...");
  
  // ✅ FALLBACK: Direct routes if file not found
  const router = express.Router();
  
  router.get("/public", (req, res) => {
    db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results });
    });
  });
  
  router.get("/admin/all", (req, res) => {
    db.query("SELECT * FROM recent_updates ORDER BY created_at DESC", (err, results) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: results });
    });
  });
  
  // ✅ DELETE route in fallback
  router.delete("/admin/delete/:id", (req, res) => {
    const { id } = req.params;
    console.log("🗑️ Fallback DELETE for ID:", id);
    
    db.query("DELETE FROM recent_updates WHERE id = ?", [id], (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: "Deleted successfully ✅" });
    });
  });
  
  app.use("/recent", router);
  console.log("✅ Fallback recent routes registered");
}

// ============================================================
// ==================== FALLBACK DIRECT ROUTES ====================
// ============================================================

// ✅ GET - All Updates (Public)
app.get("/recent-public", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: results });
  });
});

// ✅ GET - All Updates (Admin)
app.get("/recent-admin-all", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC", (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
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
      if (err) return res.status(500).json({ success: false, error: err.message });

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

// ✅ DELETE - Delete Update (FALLBACK)
app.delete("/recent-admin-delete/:id", (req, res) => {
  const { id } = req.params;
  console.log("🗑️ DELETE request for ID:", id);

  db.query(
    "SELECT * FROM recent_updates WHERE id = ?",
    [id],
    (fetchErr, fetchResult) => {
      if (fetchErr) {
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

      if (update.file_public_id) {
        cloudinary.uploader.destroy(update.file_public_id)
          .catch(err => console.error("Cloudinary delete error:", err));
      }

      db.query(
        "DELETE FROM recent_updates WHERE id = ?",
        [id],
        (deleteErr) => {
          if (deleteErr) {
            return res.status(500).json({
              success: false,
              message: "Failed to delete",
              error: deleteErr.message
            });
          }

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

  const placeholders = ids.map(() => '?').join(',');
  
  db.query(
    `SELECT * FROM recent_updates WHERE id IN (${placeholders})`,
    ids,
    (fetchErr, fetchResults) => {
      if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });

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
          if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
          res.json({ success: true, message: `${ids.length} updates deleted successfully ✅` });
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
      "/recent/public",
      "/recent/admin/all",
      "/recent/admin/add",
      "/recent/admin/update/:id",
      "/recent/admin/delete/:id",
      "/recent/admin/bulk-delete",
      "/recent-admin-delete/:id (fallback)",
      "/recent-admin-bulk-delete (fallback)"
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
  console.log("  GET  /recent/public");
  console.log("  GET  /recent/admin/all");
  console.log("  POST /recent/admin/add");
  console.log("  PUT  /recent/admin/update/:id");
  console.log("  DELETE /recent/admin/delete/:id");
  console.log("  DELETE /recent/admin/bulk-delete");
  console.log("  DELETE /recent-admin-delete/:id (fallback)");
  console.log("=".repeat(50));
});
