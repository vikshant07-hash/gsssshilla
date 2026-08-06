const express = require("express");
const cors = require("cors");
require("dotenv").config();
const path = require("path");

const { cloudinary } = require("./config/cloudinary");
const { uploadRecent } = require("./config/cloudinary");
const db = require("./config/db");

const app = express();
app.set("trust proxy", 1);

// CORS
app.use(cors({ origin: "*", credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'] }));
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
// ✅ DIRECT RECENT ROUTES (NO routes FILE NEEDED)
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
    [title, description || "", file_url, file_public_id, file_type, file_size, category || "general", link || null, isNew !== undefined ? parseInt(isNew) : 1],
    (err, result) => {
      if (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
      db.query("SELECT * FROM recent_updates WHERE id = ?", [result.insertId], (fetchErr, fetchResult) => {
        res.status(201).json({
          success: true,
          message: "✅ Update added successfully!",
          data: fetchResult ? fetchResult[0] : { id: result.insertId }
        });
      });
    }
  );
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
      return res.status(500).json({ success: false, message: "Database error", error: fetchErr.message });
    }
    if (!fetchResult || fetchResult.length === 0) {
      return res.status(404).json({ success: false, message: "Update not found with ID: " + id });
    }
    const update = fetchResult[0];
    if (update.file_public_id) {
      cloudinary.uploader.destroy(update.file_public_id)
        .then(result => console.log("✅ Cloudinary deleted:", result))
        .catch(err => console.error("❌ Cloudinary error:", err));
    }
    db.query("DELETE FROM recent_updates WHERE id = ?", [id], (deleteErr) => {
      if (deleteErr) {
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
    if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
    fetchResults.forEach(update => {
      if (update.file_public_id) {
        cloudinary.uploader.destroy(update.file_public_id)
          .catch(err => console.error("Cloudinary error:", err));
      }
    });
    db.query(`DELETE FROM recent_updates WHERE id IN (${placeholders})`, ids, (deleteErr) => {
      if (deleteErr) return res.status(500).json({ success: false, error: deleteErr.message });
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
// 404 & ERROR
// ============================================================
app.use((req, res) => {
  res.status(404).json({ success: false, message: "❌ Route not found", path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🏛️ SERVER STARTED (Direct Routes)");
  console.log("=".repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log("✅ /recent/admin/all");
  console.log("✅ /recent/public");
  console.log("✅ /recent/admin/add");
  console.log("✅ /recent/admin/delete/:id");
  console.log("=".repeat(50));
});
