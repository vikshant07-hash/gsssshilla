const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const { cloudinary } = require("./config/cloudinary");
const { uploadRecent } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// ==================== CORS ====================
// Note: credentials: true + origin: "*" ek saath kaam nahi karta (browser block kar deta hai).
// Agar aapko cookies/auth cookies chahiye, "origin" ko apne frontend ke exact URL se replace karein.
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
// app.options('*', cors());  <-- removed: crashes on newer Express/path-to-regexp versions,
// and is redundant since the cors() middleware above already handles preflight (OPTIONS) requests.

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Simple request logger - helps you see exactly which requests are hitting the server
app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.originalUrl}`);
  next();
});

// ============================================================
// ROOT & TEST
// ============================================================

app.get("/", (req, res) => {
  res.json({ success: true, message: "🏛️ School Management Backend" });
});

app.get("/test", (req, res) => {
  res.json({ success: true, message: "✅ Server Working!" });
});

// ============================================================
// ✅ RECENT ROUTES - DIRECT
// ============================================================

// GET - All Updates (Admin)
app.get("/recent/admin/all", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC", (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, data: results });
  });
});

// GET - Public Updates
app.get("/recent/public", (req, res) => {
  db.query("SELECT * FROM recent_updates ORDER BY created_at DESC LIMIT 20", (err, results) => {
    if (err) {
      console.error("❌ DB Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, data: results });
  });
});

// ============================================================
// ✅ POST - ADD UPDATE
// ============================================================

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

      db.query("SELECT * FROM recent_updates WHERE id = ?", [result.insertId], (fetchErr, fetchResult) => {
        if (fetchErr) {
          console.error("❌ Fetch after insert error:", fetchErr);
          // Insert succeeded but fetch failed — still return success with the ID we have.
          return res.status(201).json({
            success: true,
            message: "✅ Update added successfully!",
            data: { id: result.insertId }
          });
        }

        res.status(201).json({
          success: true,
          message: "✅ Update added successfully!",
          data: fetchResult && fetchResult[0] ? fetchResult[0] : { id: result.insertId }
        });
      });
    }
  );
});

// ============================================================
// ✅ DELETE - DELETE UPDATE
// ============================================================

app.delete("/recent/admin/delete/:id", (req, res) => {
  const { id } = req.params;
  console.log("🗑️ DELETE request for ID:", id);

  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID provided"
    });
  }

  db.query("SELECT * FROM recent_updates WHERE id = ?", [id], (fetchErr, fetchResult) => {
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
        message: "Update not found with ID: " + id
      });
    }

    const update = fetchResult[0];
    console.log("📦 Found update:", update.title);

    // Delete DB row first, and only report success once that succeeds.
    db.query("DELETE FROM recent_updates WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({
          success: false,
          message: "Failed to delete",
          error: deleteErr.message
        });
      }

      console.log("✅ Deleted ID:", id);

      // Cloudinary cleanup happens after DB delete confirms — failures here are
      // logged but don't block the response since the DB record is already gone.
      if (update.file_public_id) {
        cloudinary.uploader.destroy(update.file_public_id)
          .then(result => console.log("✅ Cloudinary deleted:", result))
          .catch(err => console.error("❌ Cloudinary error:", err));
      }

      res.json({
        success: true,
        message: "✅ Update deleted successfully!"
      });
    });
  });
});

// ============================================================
// ✅ DELETE - BULK DELETE
// ============================================================

app.delete("/recent/admin/bulk-delete", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No IDs provided"
    });
  }

  const placeholders = ids.map(() => '?').join(',');

  db.query(`SELECT * FROM recent_updates WHERE id IN (${placeholders})`, ids, (fetchErr, fetchResults) => {
    if (fetchErr) {
      console.error("❌ Fetch Error:", fetchErr);
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    db.query(`DELETE FROM recent_updates WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) {
        console.error("❌ Delete Error:", deleteErr);
        return res.status(500).json({ success: false, error: deleteErr.message });
      }

      // Cloudinary cleanup after DB delete confirms success.
      fetchResults.forEach(update => {
        if (update.file_public_id) {
          cloudinary.uploader.destroy(update.file_public_id)
            .catch(err => console.error("❌ Cloudinary error:", err));
        }
      });

      res.json({
        success: true,
        message: `${ids.length} updates deleted successfully ✅`
      });
    });
  });
});

// ============================================================
// ✅ GET - ADMIN STATS
// ============================================================

app.get("/recent/admin/stats", (req, res) => {
  const queries = {
    total: "SELECT COUNT(*) as total FROM recent_updates",
    new: "SELECT COUNT(*) as new FROM recent_updates WHERE is_new = 1",
    old: "SELECT COUNT(*) as old FROM recent_updates WHERE is_new = 0",
    withFile: "SELECT COUNT(*) as withFile FROM recent_updates WHERE file_url IS NOT NULL"
  };

  const results = {};
  const keys = Object.keys(queries);
  let completed = 0;
  let hasError = false;

  keys.forEach((key) => {
    db.query(queries[key], (err, result) => {
      if (err) {
        console.error(`❌ Stats query "${key}" error:`, err);
        results[key] = { error: err.message };
        hasError = true;
      } else {
        results[key] = result;
      }
      completed++;

      if (completed === keys.length) {
        res.status(hasError ? 207 : 200).json({ success: !hasError, data: results });
      }
    });
  });
});

// ============================================================
// 404 & ERROR
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "❌ Route not found",
    path: req.originalUrl
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🏛️ SERVER STARTED");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log("=".repeat(50));
  console.log("✅ Routes:");
  console.log("  GET  /");
  console.log("  GET  /test");
  console.log("  GET  /recent/public");
  console.log("  GET  /recent/admin/all");
  console.log("  POST /recent/admin/add");
  console.log("  DELETE /recent/admin/delete/:id");
  console.log("  DELETE /recent/admin/bulk-delete");
  console.log("  GET  /recent/admin/stats");
  console.log("=".repeat(50));
});
